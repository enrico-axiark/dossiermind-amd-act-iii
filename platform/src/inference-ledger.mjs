import {transaction} from './db.mjs';
import {assert} from './errors.mjs';

// A persistent request ceiling, NOT a meter for AMD credits or GPU hours.
// Reservations survive crashes and failures. Never silently refund or reset.
export class InferenceLedger {
  constructor(db,limit){
    assert(db&&typeof db.prepare==='function',500,'ai_ledger_required','Persistent inference storage required');
    assert(Number.isInteger(limit)&&limit>0&&limit<=10000,500,'ai_budget_unconfirmed','A bounded confirmed request limit is required');
    this.db=db;
    db.exec(`CREATE TABLE IF NOT EXISTS inference_budget(
      id INTEGER PRIMARY KEY CHECK(id=1),request_limit INTEGER NOT NULL,consumed INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS inference_dispatches(
      id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,state TEXT NOT NULL,
      created_at TEXT NOT NULL,finished_at TEXT,usage_json TEXT);`);
    transaction(db,()=>{
      const row=db.prepare('SELECT * FROM inference_budget WHERE id=1').get();
      assert(!row||row.request_limit===limit,500,'ai_budget_change_requires_review','Persisted request cap must not be silently changed');
      if(!row)db.prepare('INSERT INTO inference_budget VALUES(1,?,0)').run(limit);
    });
  }
  reserve(id,fingerprint){
    assert(typeof id==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(id),400,'ai_request_id_invalid','Use a stable request ID');
    assert(typeof fingerprint==='string'&&/^[a-f0-9]{64}$/.test(fingerprint),500,'ai_fingerprint_invalid','A request fingerprint is required');
    return transaction(this.db,()=>{
      const old=this.db.prepare('SELECT fingerprint,state FROM inference_dispatches WHERE id=?').get(id);
      assert(!old,409,old?.fingerprint===fingerprint?'ai_request_already_dispatched':'ai_request_id_conflict','This request ID cannot be dispatched again');
      assert(!this.db.prepare("SELECT 1 FROM inference_dispatches WHERE state IN ('reserved','sent','uncertain') LIMIT 1").get(),429,'ai_inflight_unresolved','An active or uncertain provider call needs resolution before another dispatch');
      const budget=this.db.prepare('SELECT * FROM inference_budget WHERE id=1').get();
      assert(budget.consumed<budget.request_limit,429,'ai_request_cap_reached','Persisted request cap reached');
      this.db.prepare('UPDATE inference_budget SET consumed=consumed+1 WHERE id=1').run();
      this.db.prepare('INSERT INTO inference_dispatches VALUES(?,?,?, ?,NULL,NULL)').run(id,fingerprint,'reserved',new Date().toISOString());
    });
  }
  sent(id){this.db.prepare("UPDATE inference_dispatches SET state='sent' WHERE id=? AND state='reserved'").run(id);}
  finish(id,state,usage=null){
    assert(['completed','failed','uncertain'].includes(state),500,'ai_ledger_state_invalid','Invalid dispatch state');
    this.db.prepare("UPDATE inference_dispatches SET state=?,finished_at=?,usage_json=? WHERE id=? AND state IN ('reserved','sent')").run(state,new Date().toISOString(),usage?JSON.stringify(usage):null,id);
  }
  summary(){const budget=this.db.prepare('SELECT * FROM inference_budget WHERE id=1').get();return {limit:budget.request_limit,reserved:budget.consumed,remainingRequests:budget.request_limit-budget.consumed,unresolved:!!this.db.prepare("SELECT 1 FROM inference_dispatches WHERE state IN ('reserved','sent','uncertain') LIMIT 1").get(),creditBalanceKnown:false};}
}

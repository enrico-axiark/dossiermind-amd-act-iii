import {authorizeTenant} from './auth.mjs';
// Configuration and persisted job state only; never inference quality or GPU proof.
export function aiStatus(db,gateway,tenantId,principal){
 authorizeTenant(db,principal,tenantId,'documents:read');
 const readiness=gateway.readiness();
 const counts={queued:0,running:0,completed:0,failed:0,uncertain:0};
 for(const table of ['advisor_jobs','memory_requests'])for(const row of db.prepare(`SELECT status,COUNT(*) n FROM ${table} WHERE tenant_id=? GROUP BY status`).all(tenantId))if(Object.hasOwn(counts,row.status))counts[row.status]+=row.n;
 const configured=readiness.configured===true||readiness.enabled===true,budget=readiness.requestBudget;
 const state=configured&&readiness.enabled===false?'suspended':!configured?'not_configured':budget?.unresolved&&!gateway.active?'needs_check':counts.running?'working':budget?.remainingRequests===0?'limit_reached':counts.queued?'queued':'configured';
 return {state,configured,visionConfigured:configured&&readiness.visionEnabled===true,counts,requiresHumanReview:true,configurationIsQualityProof:false};
}

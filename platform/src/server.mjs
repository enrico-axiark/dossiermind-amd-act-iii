import { createPlatformApp } from "./app.mjs";
import { IngestionWorker } from "./ingestion.mjs";
import { loadConfig } from "./config.mjs";
import {seedCompetition} from './competition-seed.mjs';
import {PlatformService} from './service.mjs';

const config = loadConfig();
const { server, db, advisor, memory } = createPlatformApp(config);
if(config.competitionSeedEnabled){
  try{seedCompetition(db,new PlatformService(db,config),config);}
  catch(error){db.close();console.error({code:error.code||'competition_seed_failed'});process.exit(1);}
}
const worker=new IngestionWorker(db,config);
worker.start();
let advisorRunning=false;
const advisorTimer=setInterval(async()=>{if(advisorRunning)return;advisorRunning=true;try{await advisor.tick();await memory.tick();}catch(error){console.error({code:error.code||"advisor_worker_failed"});}finally{advisorRunning=false;}},1000);

server.listen(config.port, config.host, () => {
  console.log(`DossierMind Platform listening on http://${config.host}:${server.address().port}`);
  if (config.allowInsecureDevAuth) console.warn("WARNING: insecure development authentication is enabled");
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  clearInterval(advisorTimer);
  for(const controller of [...advisor.active.values(),...memory.active.values()])controller.abort();
  while(advisorRunning)await new Promise(resolve=>setTimeout(resolve,25));
  await worker.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

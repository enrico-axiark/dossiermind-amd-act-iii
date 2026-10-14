// Explicit task routing, never model fallback. Both purposes share the same ledger.
import {AmdGateway} from './amd-gateway.mjs';
import {assert} from './errors.mjs';
export class AmdRouter {
 constructor(config,options={}){
  this.text=new AmdGateway(config,options);
  this.visual=config.amdVisionModel?new AmdGateway({...config,amdModel:config.amdVisionModel,amdResponseModel:config.amdVisionResponseModel||config.amdVisionModel,amdModelRevision:config.amdVisionModelRevision,amdReasoningEffort:config.amdVisionReasoningEffort??''},options):this.text;
 }
 get active(){return this.text.active===true||this.visual.active===true;}
 get ledger(){return this.text.ledger;}
 readiness(){return {...this.text.readiness(),visionEnabled:this.visual.readiness().visionEnabled===true,visionModelRevisionPinned:this.visual.readiness().modelRevisionPinned===true,separateVisionModel:this.visual!==this.text};}
 async complete(input,options){assert(!this.active,429,'ai_busy','Another inference is running');return (input.visual?this.visual:this.text).complete(input,options);}
}

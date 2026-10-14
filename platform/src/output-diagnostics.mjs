// Only server-owned schema paths and fixed validator categories may leave the
// validator. Never retain unknown model property names, values or quotations.
export function safeSchemaFailures(issues,schema){
 const names=new Set();
 function visit(node){for(const [name,child] of Object.entries(node.properties||{})){names.add(name);visit(child);}if(node.items)visit(node.items);}
 visit(schema);
 const kinds=new Set(['type mismatch','const mismatch','enum mismatch','too short','too long','pattern mismatch','invalid date-time','below minimum','above maximum','too few items','too many items','duplicate items','required','additional property']);
 return issues.slice(0,20).map(issue=>{
  const boundary=issue.lastIndexOf(': '),path=issue.slice(0,boundary),kind=issue.slice(boundary+2);
  const tokens=path.match(/[A-Za-z_][A-Za-z0-9_]*/g)||[];
  const safePath=path.length<=250&&/^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d{1,5}\])*$/.test(path)&&tokens.every(name=>names.has(name))?path:'$';
  return {path:safePath,kind:kinds.has(kind)?kind:'schema mismatch'};
 });
}

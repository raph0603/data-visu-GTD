const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
(async () => {
const root=path.resolve(__dirname,'..');
const d3={...await import('d3'),...await import('d3-sankey')};
const C=(await import('../src/modules/flow/engine.js')).default;
const G=(await import('../src/modules/flow/geometry.js')).createGeometry();
const data=C.parseCSV(fs.readFileSync(path.join(root,'public/data/gtd/flow/modes_operatoires.csv'),'utf8'),d3);
let checks=0;
const equal=(a,b,message)=>{checks++;assert.equal(a,b,message);};
const close=(a,b,message)=>{checks++;assert.ok(Math.abs(a-b)<Math.max(1e-7,Math.abs(b)*1e-9),message+`: ${a} != ${b}`);};
const ok=(condition,message)=>{checks++;assert.ok(condition,message);};
const settings={period:[1970,2017],periodB:[2008,2012],compare:false,dims:['attack','weapon','target'],metric:'count',top:7,sort:'optimized',filters:{}};
equal(data.meta.incidents,181691,'Full GTD incident count');
equal(data.rows.reduce((s,r)=>s+r[8],0),data.meta.incidents,'Compression preserves count');
equal(data.rows.reduce((s,r)=>s+r[9],0),411868,'Full GTD death total');
equal(data.rows.reduce((s,r)=>s+r[11],0),523869,'Full GTD injury total');
equal(data.meta.years.includes(1993),false,'1993 is absent, not zero');
for(const metric of ['count','killed','wounded'])for(const dims of [['attack','weapon'],['attack','weapon','target'],['country','group','attack','target']])for(const top of [3,7,12])for(const compare of [false,true]){
  const options={...settings,metric,dims,top,compare};
  const aggregated=C.aggregate(data,options),layout=G.layout(aggregated,options,d3,C.translate);
  for(let stage=0;stage<dims.length-1;stage++){
    close(layout.links.filter(l=>l.stage===stage).reduce((s,l)=>s+l.value,0),layout.total,'Conservation across each stage');
    for(const side of ['a','b'])close(layout.links.filter(l=>l.stage===stage).reduce((s,l)=>s+l[side][metric],0),layout.totals[side][metric],'Separate A/B conservation');
  }
  for(let stage=0;stage<dims.length;stage++)ok(layout.nodes.filter(n=>n.stage===stage).length<=top,'Category cap includes Autres');
  const keys=new Set(layout.nodes.map(n=>n.id));equal(keys.size,layout.nodes.length,'Stable node IDs are unique');
  for(const n of layout.nodes){
    close((n.theta1-n.theta0)/n.value,layout.angularScale,'Common radial angular scale');
    if(n.sourceLinks.length)close(n.sourceLinks.reduce((s,l)=>s+(l.rs1-l.rs0),0),n.theta1-n.theta0,'Outgoing radial port conservation');
    if(n.targetLinks.length)close(n.targetLinks.reduce((s,l)=>s+(l.rt1-l.rt0),0),n.theta1-n.theta0,'Incoming radial port conservation');
  }
  for(const l of layout.links){
    for(const key of ['h','r','ah','ar','bh','br']){equal(l[key].length,38,'Compatible six-cubic topology');ok(l[key].every(Number.isFinite),'Finite Bézier control points');}
    for(const t of [0,.1,.25,.5,.75,.9,1]){
      const p=G.path(d3.interpolateArray(l.h,l.r)(t));ok(!/NaN|undefined|Infinity/.test(p),'Continuous morph has no invalid path');
      equal((p.match(/C/g)||[]).length,6,'Path topology stays constant');
    }
    close(l.ratioA,l.a[metric]/l.value,'Comparison fraction');
  }
}
const filtered=C.aggregate(data,{...settings,period:[2013,2017],filters:{country:['Iraq'],region:['Middle East & North Africa']}});
equal(filtered.totals.a.count,data.rows.filter(r=>r[0]>=2013&&r[0]<=2017&&data.dicts.country[r[2]]==='Iraq'&&data.dicts.region[r[1]]==='Middle East & North Africa').reduce((s,r)=>s+r[8],0),'Combined geographic filters');
const none=C.aggregate(data,{...settings,period:[1993,1993]});equal(none.nodes.length,0,'Empty graph for missing year');equal(none.missingYears[0],1993,'Missing year is explicit');
const fixture='eventid,iyear,country_txt,region_txt,attacktype1_txt,weaptype1_txt,targtype1_txt,gname,suicide,nkill,nwound\n1,2017,X,R,A,W,T,Unknown,0,,0\n2,2017,X,R,A,W,T,Unknown,1,0,\n3,2017,X,R,A,W,T,G,1,3,5\n';
const imported=C.parseCSV(fixture,d3,'fixture.csv');
equal(imported.meta.incidents,3,'CSV count');equal(imported.meta.knownKilled,2,'Unknown deaths stay unknown');equal(imported.meta.knownWounded,2,'Known zero injuries stay known');
const byDeath=C.aggregate(imported,{...settings,period:[2017,2017],metric:'killed'});
equal(byDeath.totals.a.count,3,'Mortality still retains the selected incident population');
equal(byDeath.nodes.find(n=>n.dim==='attack').a.count,3,'Node tooltip includes unknown and zero-balance incidents');
equal(byDeath.total,3,'Unknowns receive no mortality thickness');
const duplicate=C.parseCSV(fixture+'3,2017,X,R,A,W,T,G,1,3,5\n',d3);equal(duplicate.meta.incidents,3,'Identical duplicates removed');
assert.throws(()=>C.parseCSV(fixture+'3,2017,X,R,A,W,T,G,1,4,5\n',d3),/contradictoires/);checks++;
assert.throws(()=>C.parseCSV('foo,bar\n1,2',d3),/Colonnes absentes/);checks++;
const agg='iyear,country_txt,region_txt,attacktype1_txt,weaptype1_txt,targtype1_txt,gname,suicide_libelle,nb_attaques,morts_enregistres,nb_bilans_morts_connus,blesses_enregistres,nb_bilans_blesses_connus\n2017,X,R,A,W,T,G,Non,3,3,2,5,2\n';
const weighted=C.parseCSV(agg,d3);equal(weighted.meta.incidents,3,'Notebook flow cube accepted');equal(weighted.meta.knownKilled,2,'Notebook unknown coverage accepted');
console.log(JSON.stringify({status:'passed',checks,realIncidents:data.meta.incidents,cubeRows:data.rows.length}));

})().catch(error=>{console.error(error);process.exitCode=1;});

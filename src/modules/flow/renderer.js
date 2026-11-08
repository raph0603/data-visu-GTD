/* FLUX — browser-local D3 exploration. No credentials or external runtime APIs. */
import * as d3Base from 'd3';
import * as sankey from 'd3-sankey';
import GTDCore from './engine.js';
import { createGeometry } from './geometry.js';

export function mountRenderer(root, baseData, palette, onStatus) {
  const document=root.ownerDocument, window=document.defaultView;
  const GTDGeometry=createGeometry(palette);
  const d3={...d3Base,...sankey};
  let alive=true;
  const timers=new Set(), frames=new Set(), objectUrls=new Set();
  const setTimeout=(fn,ms)=>{const id=window.setTimeout(()=>{timers.delete(id);if(alive)fn();},ms);timers.add(id);return id;};
  const clearTimeout=id=>{window.clearTimeout(id);timers.delete(id);};
  const requestAnimationFrame=fn=>{const id=window.requestAnimationFrame(t=>{frames.delete(id);if(alive)fn(t);});frames.add(id);return id;};
  const cancelAnimationFrame=id=>{window.cancelAnimationFrame(id);frames.delete(id);};
  const listeners=new AbortController();
  'use strict';
  const $=id=>root.querySelector('#'+id), D=GTDCore.dimensions, M=GTDCore.metrics, G=GTDGeometry, tr=GTDCore.translate;
  const integer=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}), pct=new Intl.NumberFormat('fr-FR',{style:'percent',maximumFractionDigits:1});
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let meta=baseData.meta, dicts=baseData.dicts, engineData=baseData, worker=null, rpcSequence=0, pending=new Map();
  let graph=null, querySerial=0, queryTimeout=0, lastQueryAt=0, hover=null, selected=new Set(), sourceReady=false, loading=false;
  let frameId=0, frameStart=0, frameDuration=0, nodeStates=[], linkStates=[], animation=null, toastTimeout=0;
  const snapshots=new Map(), gradientIds=new Map(); let nextGradientId=0;
  const state={period:[2013,2017],periodB:[2008,2012],compare:false,dims:['attack','weapon','target'],metric:'count',top:7,sort:'optimized',filters:{},percent:false,morph:0};
  const presets={modus:{dims:['attack','weapon','target'],hint:'Type d’attaque → arme → cible'},territory:{dims:['region','country','target'],hint:'Région → pays → cible'},actors:{dims:['group','attack','target'],hint:'Groupe attribué → type d’attaque → cible'},suicide:{dims:['suicide','attack','target'],hint:'Attentat suicide → type d’attaque → cible'}};
  let usingBase=true, countryGroups=[], sharedWarning='';
  const svg=d3.select(root.querySelector('#chart')), zoomLayer=d3.select(root.querySelector('#zoomLayer')), defs=svg.select('defs');
  const zoom=d3.zoom().extent([[0,0],[G.W,G.H]]).scaleExtent([.6,4]).filter(event=>event.type!=='wheel'||event.ctrlKey||event.metaKey).on('zoom',event=>zoomLayer.attr('transform',event.transform));
  svg.call(zoom).on('dblclick.zoom',null);
  svg.on('click.background',event=>{if(event.target===$('chart')){selected.clear();highlight();selectionInfo();}});
  try {
    if(location.protocol!=='file:' && typeof Worker!=='undefined') {
      worker=new Worker(new URL('./worker.js', import.meta.url), {type:'module'});
      worker.onmessage=({data})=>{const promise=pending.get(data.id);if(!promise)return;pending.delete(data.id);data.type==='error'?promise.reject(new Error(data.error)):promise.resolve(data);};
      worker.onerror=()=>{worker?.terminate();worker=null;for(const p of pending.values())p.reject(new Error('Le moteur de calcul a redémarré. Réessayez.'));pending.clear();};
    }
  } catch {worker=null;}
  async function rpc(type,payload={}) {
    if(worker) return new Promise((resolve,reject)=>{const id=++rpcSequence;pending.set(id,{resolve,reject});worker.postMessage({id,type,...payload},payload.buffer?[payload.buffer]:[]);});
    await new Promise(resolve=>setTimeout(resolve,0));
    if(type==='init'){engineData=payload.dataset;return {meta:engineData.meta,dicts:engineData.dicts};}
    if(type==='query')return {graph:GTDCore.aggregate(engineData,payload.settings)};
    if(type==='import') {
      let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(payload.buffer);}catch{text=new TextDecoder('windows-1252').decode(payload.buffer);}
      const parsed=GTDCore.parseCSV(text,d3,payload.filename);engineData=parsed;return {meta:parsed.meta,dicts:parsed.dicts};
    }
  }
  function toast(message) {$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').hidden=true,4200);}
  function format(v) {return integer.format(v || 0);}
  function formattedValue(value,total=graph?.total) {return state.percent?pct.format(total?value/total:0):format(value);}
  function knownSum(s,metric) {const key=metric==='killed'?'knownKilled':'knownWounded';return s[key]>0?format(s[metric]):'ND';}
  function bounds() {return [Math.min(...meta.years),Math.max(...meta.years)];}
  function defaultPeriods() {const [min,max]=bounds();state.period=[Math.max(min,max-4),max];state.periodB=[Math.max(min,max-9),Math.max(min,max-5)];}
  function syncPeriodControls() {
    const [min,max]=bounds();
    for(const suffix of ['', 'B']) {
      const period=suffix?state.periodB:state.period;
      for(const [id,index] of [['yearStart',0],['yearEnd',1],['startRange',0],['endRange',1]]) {const e=$(id+suffix);e.min=min;e.max=max;e.step=1;e.value=period[index];}
      const denominator=max-min||1;$(suffix?'periodFillB':'periodFill').style.left=(period[0]-min)/denominator*100+'%';$(suffix?'periodFillB':'periodFill').style.right=(max-period[1])/denominator*100+'%';
    }
    $('minYear').textContent=min;$('maxYear').textContent=max;$('comparisonFields').hidden=!state.compare;$('periodLabel').hidden=!state.compare;
    $('compareToggle').checked=state.compare;$('compareLegend').hidden=!state.compare;$('compareKpiTag').hidden=!state.compare;
  }
  function setPeriod(index,value,isB=false) {
    const [min,max]=bounds(),p=isB?state.periodB:state.period;
    const year=Math.max(min,Math.min(max,Number(value)));if(!Number.isInteger(year))return;
    p[index]=year;if(p[0]>p[1])p[1-index]=year;
    syncPeriodControls();queueQuery(80);
  }
  function makeMultiFilter(container,dim,title,options,forceOpen=false) {
    const previous=container.querySelector('details'),isOpen=previous?.open || forceOpen,searchValue=previous?.querySelector('input[type=search]')?.value||'';
    container.replaceChildren();
    const details=document.createElement('details');details.className='multifilter';details.open=isOpen;
    const summary=document.createElement('summary'),label=document.createElement('span'),count=document.createElement('span');
    const chosen=state.filters[dim]||[];label.textContent=title;count.className='multifilter-count';count.textContent=chosen.length?(dim==='country'?chosen.length+' libellés':chosen.length):'Toutes';summary.append(label,count);details.append(summary);
    const body=document.createElement('div');body.className='multifilter-body';const search=document.createElement('input');search.type='search';search.className='multifilter-search';search.placeholder='Rechercher…';search.setAttribute('aria-label','Rechercher dans '+D[dim].title);search.value=searchValue;
    const list=document.createElement('div');list.className='multifilter-options';
    const combined=[...new Set([...options,...chosen])].sort((a,b)=>tr(a).localeCompare(tr(b),'fr'));
    for(const name of combined) {
      const row=document.createElement('label');row.className='multifilter-option';row.dataset.search=tr(name).toLowerCase();
      const input=document.createElement('input');input.type='checkbox';input.checked=chosen.includes(name);input.value=name;input.setAttribute('aria-label',tr(name));
      const text=document.createElement('span');text.textContent=tr(name);row.append(input,text);list.append(row);
      input.addEventListener('change',()=>{const values=new Set(state.filters[dim]||[]);input.checked?values.add(name):values.delete(name);state.filters[dim]=[...values];count.textContent=values.size||'Toutes';queueQuery();});
    }
    function searchOptions(){const q=search.value.toLowerCase().trim();for(const row of list.children)row.hidden=!row.dataset.search.includes(q);}
    search.addEventListener('input',searchOptions);searchOptions();
    const tools=document.createElement('div');tools.className='multifilter-tools';
    const all=document.createElement('button');all.textContent='Cocher les résultats';all.addEventListener('click',()=>{const set=new Set(state.filters[dim]||[]);for(const row of list.children)if(!row.hidden){const cb=row.querySelector('input');set.add(cb.value);cb.checked=true;}state.filters[dim]=[...set];count.textContent=set.size||'Toutes';queueQuery();});
    const clear=document.createElement('button');clear.textContent='Effacer';clear.addEventListener('click',()=>{state.filters[dim]=[];for(const cb of list.querySelectorAll('input'))cb.checked=false;count.textContent='Toutes';queueQuery();});
    tools.append(all,clear);body.append(search,list,tools);details.append(body);container.append(details);
  }
  function refreshFilterLists() {
    const focused=document.activeElement,containerId=focused?.closest('#regionFilter,#countryFilter,#categoryFilter')?.id,focusType=focused?.type,focusValue=focused?.value;
    makeMultiFilter($('regionFilter'),'region','Régions',dicts.region);
    makeMultiFilter($('countryFilter'),'country','Pays',graph?.availableCountries||dicts.country);
    const dim=$('categoryDimension').value||'attack';makeMultiFilter($('categoryFilter'),dim,'Catégories',dicts[dim]);
    if(containerId){const replacement=[...$(containerId).querySelectorAll('input')].find(input=>input.type===focusType&&(focusType==='search'||input.value===focusValue));replacement?.focus({preventScroll:true});}
  }
  function configureDimensions() {
    const holder=$('dimensionControls');holder.replaceChildren();
    state.dims.forEach((dim,index)=>{
      const row=document.createElement('div');row.className='dimension-row';
      const number=document.createElement('span');number.className='dimension-number';number.textContent=String(index+1).padStart(2,'0');
      const select=document.createElement('select');select.setAttribute('aria-label','Dimension du niveau '+(index+1));
      for(const [key,d] of Object.entries(D)){const option=new Option(d.title,key);option.disabled=key!==dim&&state.dims.includes(key);select.add(option);}select.value=dim;
      select.addEventListener('change',()=>{if(state.dims.includes(select.value)&&select.value!==dim)return;state.dims[index]=select.value;customDimensions();});
      const up=document.createElement('button');up.className='icon-button';up.textContent='↑';up.title='Déplacer '+D[dim].title+' vers le début';up.setAttribute('aria-label',up.title);up.disabled=index===0;up.addEventListener('click',()=>{[state.dims[index-1],state.dims[index]]=[state.dims[index],state.dims[index-1]];customDimensions();});
      const down=document.createElement('button');down.className='icon-button';down.textContent='↓';down.title='Déplacer '+D[dim].title+' vers la fin';down.setAttribute('aria-label',down.title);down.disabled=index===state.dims.length-1;down.addEventListener('click',()=>{[state.dims[index+1],state.dims[index]]=[state.dims[index],state.dims[index+1]];customDimensions();});
      const remove=document.createElement('button');remove.className='icon-button remove-dim';remove.textContent='×';remove.title='Retirer '+D[dim].title;remove.setAttribute('aria-label',remove.title);remove.disabled=state.dims.length<=2;remove.addEventListener('click',()=>{state.dims.splice(index,1);customDimensions();});
      row.append(number,select,up,down,remove);holder.append(row);
    });
    $('addDimension').disabled=state.dims.length>=4;
    $('dimensionBreadcrumb').replaceChildren();state.dims.forEach((dim,i)=>{if(i){const a=document.createElement('span');a.className='breadcrumb-arrow';a.textContent='→';$('dimensionBreadcrumb').append(a);}const e=document.createElement('span');e.textContent=D[dim].title;const n=document.createElement('span');n.className='step-index';n.textContent=String(i+1).padStart(2,'0');$('dimensionBreadcrumb').append(n,e);});
  }
  function customDimensions() {$('preset').value='custom';$('presetHint').textContent=state.dims.map(d=>D[d].title).join(' → ');configureDimensions();queueQuery();}
  function syncControls() {syncPeriodControls();configureDimensions();$('metric').value=state.metric;$('topCategories').value=state.top;$('topValue').textContent=state.top;$('sort').value=state.sort;refreshFilterLists();updateUnits();}
  function queueQuery(delay=30) {if(!sourceReady||loading)return;if(!queryTimeout)queryTimeout=setTimeout(()=>{queryTimeout=0;lastQueryAt=performance.now();queryGraph();},Math.max(0,delay-(performance.now()-lastQueryAt)));updateFilterBadge();}
  function updateFilterBadge() {const count=Object.values(state.filters).filter(v=>v.length).length;const [min,max]=bounds();$('filterCount').textContent=count+(state.period[0]!==min||state.period[1]!==max?1:0);}
  async function queryGraph() {
    const serial=++querySerial,settings=JSON.parse(JSON.stringify(state));$('updating').hidden=false;
    try {
      const result=await rpc('query',{settings});if(!alive||serial!==querySerial)return;
      const next=G.layout(result.graph,settings,d3,tr);graph=next;hover=null;$('tooltip').hidden=true;
      const ids=new Set(graph.nodes.map(n=>n.id));selected=new Set([...selected].filter(id=>ids.has(id)));
      beginTransition(next);updateStatistics();renderTimeline();renderLegend();refreshFilterLists();highlight();selectionInfo();
      $('emptyState').hidden=graph.links.length>0;
      if(!graph.links.length)$('emptyMessage').textContent=graph.totals.a.count>0?'Les incidents sélectionnés n’ont aucun volume positif pour cette métrique. Choisissez « Nombre d’incidents » pour les afficher.':'Essayez une autre période ou élargissez vos filtres.';
      $('updating').hidden=true;
      if(!$('boot').classList.contains('leaving')){$('boot').classList.add('leaving');setTimeout(()=>$('boot').hidden=true,500);}
    } catch(error) {if(alive&&serial===querySerial){$('updating').hidden=true;toast(error.message);$('boot').hidden=true;}}
  }
  function fieldsForNode(n) {return {h:n.h,r:n.r,lh:n.labelH,lr:n.labelR,leader:n.leaderR,op:1};}
  function fieldsForLink(l) {return {h:l.h,r:l.r,ah:l.ah,ar:l.ar,bh:l.bh,br:l.br,gh:l.gradient,gr:l.gradientR,op:1};}
  function createAnimatedEntry(kind,datum,to) {
    const key=kind+datum.id,old=snapshots.get(key),from={};
    for(const field in to)from[field]=old?.[field]!==undefined?(Array.isArray(old[field])?old[field].slice():old[field]):field==='op'?0:(['h','r','ah','ar','bh','br'].includes(field)?G.collapse(to[field]):to[field].slice());
    const interpolators={};for(const field in to)interpolators[field]=Array.isArray(to[field])?d3.interpolateArray(from[field],to[field]):d3.interpolateNumber(from[field],to[field]);
    const morph={path:d3.interpolateArray(to.h,to.r)};
    if(kind==='l'){morph.a=d3.interpolateArray(to.ah,to.ar);morph.b=d3.interpolateArray(to.bh,to.br);morph.gradient=d3.interpolateArray(to.gh,to.gr);}
    return {key,datum,to,interpolators,morph,exiting:false,current:from};
  }
  function beginTransition(next) {
    const newNodes=next.nodes.map(n=>createAnimatedEntry('n',n,fieldsForNode(n))),newLinks=next.links.map(l=>createAnimatedEntry('l',l,fieldsForLink(l)));
    const nodeIds=new Set(newNodes.map(s=>s.key)),linkIds=new Set(newLinks.map(s=>s.key));
    function exiting(oldStates,ids,kind){return oldStates.filter(s=>!ids.has(s.key)).map(s=>{const snap=snapshots.get(s.key)||s.to,to={...snap,op:0};for(const key of ['h','r','ah','ar','bh','br'])if(to[key])to[key]=G.collapse(to[key]);const e=createAnimatedEntry(kind,s.datum,to);e.exiting=true;return e;});}
    nodeStates=[...newNodes,...exiting(nodeStates,nodeIds,'n')];linkStates=[...newLinks,...exiting(linkStates,linkIds,'l')];
    for(const s of linkStates)if(!gradientIds.has(s.datum.id))gradientIds.set(s.datum.id,'flow-gradient-'+(++nextGradientId));
    const gradients=defs.selectAll('linearGradient.flow-gradient').data(linkStates,s=>s.key).join(enter=>{const e=enter.append('linearGradient').attr('class','flow-gradient').attr('gradientUnits','userSpaceOnUse');e.append('stop').attr('offset','0%');e.append('stop').attr('offset','100%');return e;});
    gradients.attr('id',s=>gradientIds.get(s.datum.id));gradients.select('stop:first-child').attr('stop-color',s=>s.datum.source.color);gradients.select('stop:last-child').attr('stop-color',s=>s.datum.target.color);
    const flows=d3.select(root.querySelector('.flow-layer')).selectAll('g.flow').data(linkStates,s=>s.key).join(enter=>{const e=enter.append('g').attr('class','flow');e.append('path').attr('class','flow-a');e.append('path').attr('class','flow-b');return e;});
    flows.sort((a,b)=>b.datum.value-a.datum.value).attr('tabindex',s=>s.exiting?-1:0).attr('role','button').attr('aria-label',s=>tr(s.datum.source.label)+' vers '+tr(s.datum.target.label)+', '+format(s.datum.value)+' '+M[state.metric].title).attr('aria-hidden',s=>s.exiting?'true':null);
    flows.select('.flow-a').attr('fill',s=>'url(#'+gradientIds.get(s.datum.id)+')').attr('stroke',s=>s.datum.source.color);
    flows.select('.flow-b').attr('fill',s=>d3.interpolateRgb(s.datum.target.color,'#edf5ff')(.62)).attr('stroke',s=>s.datum.target.color).style('display',state.compare?null:'none');
    flows.on('pointerenter',function(event,s){if(s.exiting)return;hover={type:'link',id:s.datum.id};highlight();showLinkTooltip(s.datum,event);}).on('pointermove',(event,s)=>{if(!s.exiting)positionTooltip(event);}).on('pointerleave',()=>{hover=null;highlight();$('tooltip').hidden=true;}).on('focus',function(event,s){if(s.exiting)return;hover={type:'link',id:s.datum.id};highlight();showLinkTooltip(s.datum,focusEvent(this));}).on('blur',()=>{hover=null;highlight();$('tooltip').hidden=true;}).on('click',(event,s)=>{if(s.exiting)return;event.stopPropagation();selectNodes([s.datum.source.id,s.datum.target.id],event);}).on('keydown',(event,s)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectNodes([s.datum.source.id,s.datum.target.id],event);}});
    const nodes=d3.select(root.querySelector('.node-layer')).selectAll('g.node').data(nodeStates,s=>s.key).join(enter=>{const e=enter.append('g').attr('class','node');e.append('path').attr('class','node-shape');e.append('path').attr('class','node-hit');return e;});
    nodes.attr('tabindex',s=>s.exiting?-1:0).attr('role','button').attr('aria-label',s=>D[s.datum.dim].title+', '+tr(s.datum.label)+', '+format(s.datum.value)+' '+M[state.metric].title).attr('aria-pressed',s=>selected.has(s.datum.id)).attr('aria-hidden',s=>s.exiting?'true':null);
    nodes.select('.node-shape').attr('fill',s=>s.datum.color).attr('stroke',s=>d3.interpolateRgb(s.datum.color,'#ffffff')(.32)).attr('fill-opacity',.87);
    nodes.on('pointerenter',function(event,s){if(s.exiting)return;hover={type:'node',id:s.datum.id};highlight();showNodeTooltip(s.datum,event);d3.select(this).select('.node-shape').interrupt('glow').transition('glow').duration(120).attr('fill-opacity',1);}).on('pointermove',event=>positionTooltip(event)).on('pointerleave',function(){hover=null;highlight();$('tooltip').hidden=true;d3.select(this).select('.node-shape').interrupt('glow').transition('glow').duration(180).attr('fill-opacity',.87);}).on('focus',function(event,s){if(s.exiting)return;hover={type:'node',id:s.datum.id};highlight();showNodeTooltip(s.datum,focusEvent(this));}).on('blur',()=>{hover=null;highlight();$('tooltip').hidden=true;}).on('click',(event,s)=>{if(s.exiting)return;event.stopPropagation();selectNodes([s.datum.id],event);}).on('keydown',(event,s)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectNodes([s.datum.id],event);}});
    const labels=d3.select(root.querySelector('.label-layer')).selectAll('g.node-label').data(nodeStates,s=>s.key).join(enter=>{const e=enter.append('g').attr('class','node-label');e.append('path').attr('class','leader');e.append('text').attr('class','label-name');e.append('text').attr('class','label-value');return e;});
    labels.select('.label-name').text(s=>s.datum.short);labels.select('.label-value').text(s=>formattedValue(s.datum.value));
    const guides=d3.select(root.querySelector('.radial-guides')).selectAll('path').data(next.guides,s=>s.stage).join('path');
    guides.attr('d',s=>{const p=d3.path();p.arc(G.CX,G.CY,G.R+22,s.start,s.end);return p.toString();});
    frameStart=performance.now();frameDuration=reducedMotion?0:640;requestFrame();
  }
  function requestFrame(){if(!frameId)frameId=requestAnimationFrame(renderFrame);}
  function renderFrame(now) {
    frameId=0;
    if(animation){const raw=Math.min(1,(now-animation.start)/animation.duration);state.morph=animation.interpolate(d3.easeCubicInOut(raw));syncMorphUI();if(raw>=1){animation=null;syncAnimateUI();}}
    const raw=frameDuration?Math.min(1,(now-frameStart)/frameDuration):1,e=d3.easeCubicOut(raw),t=state.morph/100;
    function compute(entries){for(const s of entries){const v={};for(const f in s.interpolators)v[f]=s.interpolators[f](e);s.current=v;snapshots.set(s.key,v);}}
    compute(nodeStates);compute(linkStates);
    const blend=(a,b)=>d3.interpolateArray(a,b)(t);
    d3.select(root.querySelector('.flow-layer')).selectAll('g.flow').style('opacity',s=>s.current.op*(state.compare ? .68 : .51-.1*t)).each(function(s){const v=s.current;d3.select(this).select('.flow-a').attr('d',G.path(raw===1?(state.compare?s.morph.a(t):s.morph.path(t)):blend(state.compare?v.ah:v.h,state.compare?v.ar:v.r)));d3.select(this).select('.flow-b').attr('d',G.path(raw===1?s.morph.b(t):blend(v.bh,v.br)));});
    defs.selectAll('linearGradient.flow-gradient').each(function(s){const v=raw===1?s.morph.gradient(t):blend(s.current.gh,s.current.gr);d3.select(this).attr('x1',v[0]).attr('y1',v[1]).attr('x2',v[2]).attr('y2',v[3]);});
    d3.select(root.querySelector('.node-layer')).selectAll('g.node').style('opacity',s=>s.current.op).each(function(s){const p=G.path(raw===1?s.morph.path(t):blend(s.current.h,s.current.r));d3.select(this).select('.node-shape').attr('d',p);d3.select(this).select('.node-hit').attr('d',p);});
    const labelPositions=G.resolveLabels(nodeStates.map(s=>({id:s.key,h:s.current.lh,r:s.current.lr,width:s.datum.labelWidth,hasValue:Math.abs(s.datum.y1-s.datum.y0)>29&&state.top<=9})),t);
    d3.select(root.querySelector('.label-layer')).selectAll('g.node-label').style('opacity',s=>s.current.op).each(function(s){const v=s.current,p=labelPositions.get(s.key),showValue=Math.abs(s.datum.y1-s.datum.y0)>29&&state.top<=9;d3.select(this).select('.label-name').attr('x',p[0]).attr('y',p[1]).style('font-size',state.top>9?'10.5px':null);d3.select(this).select('.label-value').attr('x',p[0]).attr('y',p[1]+14).style('opacity',showValue?Math.pow(Math.abs(2*t-1),3):0);const center=blend(s.datum.nodeCenterH,s.datum.nodeCenterR),endX=center[0]<p[0]?p[0]-7:p[0]+s.datum.labelWidth+7;d3.select(this).select('.leader').attr('d','M'+center[0]+','+center[1]+'L'+(center[0]+endX)/2+','+(p[1]-3)+'L'+endX+','+(p[1]-3)).style('opacity',Math.max(0,(t-.12)/.88)*.7);});
    d3.select(root.querySelector('.radial-guides')).style('opacity',t*t);
    if(raw===1 && (nodeStates.some(s=>s.exiting)||linkStates.some(s=>s.exiting))) {
      nodeStates=nodeStates.filter(s=>{if(s.exiting)snapshots.delete(s.key);return !s.exiting;});linkStates=linkStates.filter(s=>{if(s.exiting)snapshots.delete(s.key);return !s.exiting;});
      d3.select(root.querySelector('.node-layer')).selectAll('g.node').data(nodeStates,s=>s.key).exit().remove();d3.select(root.querySelector('.label-layer')).selectAll('g.node-label').data(nodeStates,s=>s.key).exit().remove();d3.select(root.querySelector('.flow-layer')).selectAll('g.flow').data(linkStates,s=>s.key).exit().remove();defs.selectAll('linearGradient.flow-gradient').data(linkStates,s=>s.key).exit().remove();
    }
    if(raw<1||animation)requestFrame();
  }
  function syncMorphUI() {$('morphSlider').value=state.morph;$('morphValue').textContent=Math.round(state.morph)+' %';$('geometryLabel').textContent=state.morph<2?'SANKEY':state.morph>98?'RADIAL':'MORPHING';$('horizontalButton').classList.toggle('active',state.morph<50);$('radialButton').classList.toggle('active',state.morph>=50);$('morphSlider').setAttribute('aria-valuetext',Math.round(state.morph)+' % vers la disposition radiale');}
  function syncAnimateUI() {$('animateIcon').textContent=animation?'Ⅱ':'▷';$('animateText').textContent=animation?'Pause':'Transformer';$('animateButton').title=animation?'Mettre en pause la transformation':'Animer la transformation (Espace)';}
  function morphTo(value,duration=2200) {if(reducedMotion){animation=null;state.morph=value;syncMorphUI();syncAnimateUI();requestFrame();return;}animation={start:performance.now(),duration,interpolate:d3.interpolateNumber(state.morph,value)};syncAnimateUI();requestFrame();}
  function toggleAnimation() {if(animation){animation=null;syncAnimateUI();}else morphTo(state.morph<50?100:0);}
  function selectNodes(ids,event={}) {if(event.shiftKey||event.ctrlKey||event.metaKey){for(const id of ids)selected.has(id)?selected.delete(id):selected.add(id);}else{const same=ids.length===selected.size&&ids.every(id=>selected.has(id));selected=same?new Set():new Set(ids);}hover=null;highlight();selectionInfo();$('tooltip').hidden=true;}
  function highlight() {
    const activeNodes=new Set(),activeLinks=new Set();let active=false;
    if(hover?.type==='link'){const l=graph?.links.find(l=>l.id===hover.id);if(l){activeLinks.add(l.id);activeNodes.add(l.source.id);activeNodes.add(l.target.id);active=true;}}
    else {const ids=hover?.type==='node'?[hover.id]:[...selected];if(ids.length){active=true;ids.forEach(id=>activeNodes.add(id));for(const l of graph?.links||[])if(ids.includes(l.source.id)||ids.includes(l.target.id)){activeLinks.add(l.id);activeNodes.add(l.source.id);activeNodes.add(l.target.id);}}}
    d3.selectAll(root.querySelectorAll('.flow')).classed('is-dim',s=>active&&!activeLinks.has(s.datum.id)).classed('is-highlight',s=>active&&activeLinks.has(s.datum.id));
    d3.selectAll(root.querySelectorAll('.node')).classed('is-dim',s=>active&&!activeNodes.has(s.datum.id)).classed('is-highlight',s=>active&&activeNodes.has(s.datum.id)).classed('is-selected',s=>selected.has(s.datum.id)).attr('aria-pressed',s=>selected.has(s.datum.id));
    d3.selectAll(root.querySelectorAll('.node-label')).classed('is-dim',s=>active&&!activeNodes.has(s.datum.id));
    for(const item of $('legend').querySelectorAll('.legend-item'))item.classList.toggle('is-selected',selected.has(item.dataset.id));
  }
  function selectionInfo() {
    const chosen=(graph?.nodes||[]).filter(n=>selected.has(n.id));$('selectionBar').hidden=!chosen.length;
    if(chosen.length===1){const n=chosen[0];$('selectionInfo').innerHTML='<strong>'+esc(tr(n.label))+'</strong> · '+esc(D[n.dim].title)+' · '+formattedValue(n.value)+(state.percent?' du total':' '+esc(M[state.metric].title.toLowerCase()));}
    else if(chosen.length)$('selectionInfo').innerHTML='<strong>'+chosen.length+' catégories sélectionnées</strong> · '+chosen.map(n=>esc(tr(n.label))).slice(0,3).join(' / ')+(chosen.length>3?'…':'');
  }
  function isolateSelection() {
    if(!graph)return;
    const byDim={};for(const n of graph.nodes)if(selected.has(n.id)){byDim[n.dim]??=new Set();n.members.forEach(m=>byDim[n.dim].add(m));}
    for(const [dim,values] of Object.entries(byDim))state.filters[dim]=[...values];
    selected.clear();syncControls();queueQuery(0);toast('La sélection est appliquée aux filtres.');
  }
  function focusEvent(element) {const b=element.getBoundingClientRect();return {clientX:b.left+b.width/2,clientY:b.top+b.height/2};}
  function positionTooltip(event) {const tip=$('tooltip');if(tip.hidden)return;const width=tip.offsetWidth||280,height=tip.offsetHeight||220;let x=event.clientX+18,y=event.clientY+16;if(x+width>innerWidth-12)x=event.clientX-width-18;if(y+height>innerHeight-12)y=innerHeight-height-12;tip.style.left=Math.max(12,x)+'px';tip.style.top=Math.max(12,y)+'px';}
  function periodStats(s,total,period,label) {
    return '<div class="tip-row"><span class="tip-period"><i class="compare-dot '+(label==='B'?'b':'a')+'"></i>'+label+' · '+period.join('–')+'</span><strong>'+format(s[state.metric])+'</strong></div><div class="tip-row"><span>Part de la sélection '+label+'</span><strong>'+pct.format(total[state.metric]?s[state.metric]/total[state.metric]:0)+'</strong></div>';
  }
  function qualityTooltip(n) {
    const s=n.a,known=state.metric==='wounded'?s.knownWounded:s.knownKilled;
    return '<div class="tip-divider"></div><div class="tip-row"><span>Incidents associés · A</span><strong>'+format(s.count)+'</strong></div><div class="tip-row"><span>Bilans '+(state.metric==='wounded'?'blessés':'morts')+' connus · A</span><strong>'+format(known)+' / '+format(s.count)+'</strong></div>';
  }
  function showNodeTooltip(n,event) {
    if(!graph)return;
    $('tooltip').innerHTML='<div class="tip-eyebrow">'+esc(D[n.dim].title.toUpperCase())+'</div><div class="tip-title">'+esc(tr(n.label))+'</div>'+(tr(n.label)!==n.label&&n.cat!==-1?'<div class="tip-raw">'+esc(n.label)+'</div>':'')+'<div class="tip-value">'+format(n.value)+'</div><div class="tip-row"><span>'+esc(M[state.metric].title)+(state.compare?' · A + B':'')+'</span><strong>'+pct.format(graph.total?n.value/graph.total:0)+'</strong></div>'+periodStats(n.a,graph.totals.a,state.period,'A')+(state.compare?periodStats(n.b,graph.totals.b,state.periodB,'B'):'')+qualityTooltip(n)+(n.cat===-1?'<div class="tip-members">'+n.members.length+' catégories regroupées : '+n.members.slice(0,5).map(s=>esc(tr(s))).join(', ')+(n.members.length>5?'…':'')+'</div>':'')+'<div class="tip-hint">Cliquer pour sélectionner · Maj + clic pour cumuler</div>';
    $('tooltip').hidden=false;positionTooltip(event);
  }
  function showLinkTooltip(l,event) {
    if(!graph)return;
    const sourceShare=l.source.a[state.metric]?l.a[state.metric]/l.source.a[state.metric]:0;
    $('tooltip').innerHTML='<div class="tip-eyebrow">'+esc(D[l.source.dim].title)+' → '+esc(D[l.target.dim].title)+'</div><div class="tip-title">'+esc(tr(l.source.label))+'<br>→ '+esc(tr(l.target.label))+'</div><div class="tip-value">'+format(l.value)+'</div><div class="tip-row"><span>'+esc(M[state.metric].title)+(state.compare?' · A + B':'')+'</span><strong>'+pct.format(l.fraction)+'</strong></div>'+periodStats(l.a,graph.totals.a,state.period,'A')+(state.compare?periodStats(l.b,graph.totals.b,state.periodB,'B'):'')+'<div class="tip-row"><span>Part du nœud source · A</span><strong>'+pct.format(sourceShare)+'</strong></div>'+qualityTooltip(l)+'<div class="tip-hint">Les rubans relient des attributs d’incidents, pas des déplacements.</div>';
    $('tooltip').hidden=false;positionTooltip(event);
  }
  function renderLegend() {
    $('legend').replaceChildren();
    for(const dim of state.dims){const block=document.createElement('div');block.className='legend-group';const title=document.createElement('div');title.className='legend-group-title';title.textContent=D[dim].title;const items=document.createElement('div');items.className='legend-items';for(const n of graph.nodes.filter(n=>n.dim===dim).sort((a,b)=>b.value-a.value)){const button=document.createElement('button');button.className='legend-item';button.dataset.id=n.id;button.title=tr(n.label);const swatch=document.createElement('span');swatch.className='legend-swatch';swatch.style.background=n.color;const text=document.createElement('span');text.textContent=tr(n.label);button.append(swatch,text);button.addEventListener('pointerenter',event=>{hover={type:'node',id:n.id};highlight();showNodeTooltip(n,event);});button.addEventListener('pointermove',positionTooltip);button.addEventListener('pointerleave',()=>{hover=null;highlight();$('tooltip').hidden=true;});button.addEventListener('click',event=>selectNodes([n.id],event));items.append(button);}block.append(title,items);$('legend').append(block);}
  }
  function renderTimeline() {
    const chart=d3.select(root.querySelector('#timeline')),[min,max]=bounds(),available=new Set(meta.years),allYears=d3.range(min,max+1),values=new Map(graph.timeline.map(d=>[d.year,d.value])),x=d3.scaleBand().domain(allYears).range([0,226]).padding(.23),y=d3.scaleSqrt().domain([0,d3.max(graph.timeline,d=>d.value)||1]).range([44,3]);
    chart.selectAll('rect').data(allYears,d=>d).join('rect').attr('x',x).attr('width',Math.max(.7,x.bandwidth())).attr('y',d=>available.has(d)?y(values.get(d)||0):2).attr('height',d=>available.has(d)?Math.max(.7,44-y(values.get(d)||0)):42).attr('fill',d=>!available.has(d)?'#c5a66d':d>=state.period[0]&&d<=state.period[1]?'#0072b2':'#c9c8c1').attr('opacity',d=>available.has(d)?.8:.35).selectAll('title').data(d=>[d]).join('title').text(d=>d+' : '+(available.has(d)?format(values.get(d)||0):'année absente'));
  }
  function updateContext() {
    const countries=state.filters.country||[],regions=state.filters.region||[];
    const groups=usingBase?countryGroups.filter(g=>g.values.every(v=>countries.includes(v))):[];
    const grouped=new Set(groups.flatMap(g=>g.values));
    const countryLabels=[...groups.map(g=>g.label),...countries.filter(v=>!grouped.has(v)).map(tr)];
    const geography=countries.length ? (countryLabels.length<=3?countryLabels.join(' · '):countryLabels.length+' pays et territoires sélectionnés') : regions.length ? regions.map(tr).join(' · ') : 'Tous les pays';
    const modus=state.dims.join(',')==='attack,weapon,target';
    $('scopeTitle').textContent=geography+' — '+(modus?'modes opératoires':'associations entre catégories');
    const periodText=state.compare?'Période A : '+state.period.join('–')+' · Période B : '+state.periodB.join('–'):'Période : '+state.period.join('–');
    $('scopePeriod').textContent=periodText;
    const countText=state.compare?format(graph.totals.a.count)+' incidents en A · '+format(graph.totals.b.count)+' en B':format(graph.totals.a.count)+' incidents dans le périmètre affiché';
    $('scopeSummary').textContent=countText+(graph.totals.a.count===0?' — aucun incident pour ces filtres.':'.');
    $('scopeWarning').textContent=usingBase?sharedWarning:'';$('scopeWarning').hidden=!$('scopeWarning').textContent;
    $('scopeDataset').textContent=usingBase?'Source : '+meta.name:'CSV importé : '+meta.name;
    const holder=$('activeFilters');holder.replaceChildren();
    const active=Object.entries(state.filters).filter(([dim,values])=>D[dim]&&values.length);
    const addChip=(dim,label,values)=>{
      const button=document.createElement('button');button.className='filter-chip';button.type='button';
      const fullLabel=D[dim].title+' : '+label;button.textContent=fullLabel+' ×';button.setAttribute('aria-label','Retirer le filtre '+fullLabel);
      button.addEventListener('click',()=>{state.filters[dim]=(state.filters[dim]||[]).filter(v=>!values.includes(v));selected.clear();syncControls();queueQuery(0);});
      holder.append(button);
    };
    for(const [dim,values] of active) {
      if(dim==='country')for(const group of groups)addChip(dim,group.label,group.values);
      for(const value of values)if(dim!=='country'||!grouped.has(value))addChip(dim,tr(value),[value]);
    }
    $('scopeTerritories').textContent=groups.filter(g=>g.values.length>1).map(g=>g.label+' — libellés GTD inclus : '+g.values.join(', ')+'.').join(' ');
    $('scopeTerritories').hidden=!$('scopeTerritories').textContent;
    if(!active.length){const label=document.createElement('span');label.className='scope-unfiltered';label.textContent='Tous les pays · Toutes les catégories';holder.append(label);}
    $('scopeReading').textContent=(state.compare?'Épaisseur des rubans = '+M[state.metric].title.toLowerCase()+' en A + B. Les infobulles distinguent les deux périodes.':'Épaisseur des rubans = '+M[state.metric].title.toLowerCase()+'.')+' Sens de lecture : '+state.dims.map(d=>D[d].title).join(' → ')+'.';
    const notice=usingBase?'Ces filtres s’appliquent au Sankey uniquement. « Reprendre la sélection commune » retrouve les choix des autres planches.':'CSV importé : cette exploration reste indépendante des autres planches.';
    $('sharedNotice').textContent=notice;
    onStatus(geography+' · '+periodText+' · '+countText);

  }
  function updateStatistics() {
    updateContext();
    const a=graph.totals.a,b=graph.totals.b;
    $('incidentsKpi').textContent=state.compare?format(a.count)+' / '+format(b.count):format(a.count);
    $('killedKpi').textContent=state.compare?knownSum(a,'killed')+' / '+knownSum(b,'killed'):knownSum(a,'killed');
    $('linksKpi').textContent=format(graph.links.length);$('nodesKpi').textContent=graph.nodes.length+' nœuds · '+state.dims.length+' niveaux';
    $('periodKpi').textContent=state.compare?'A '+state.period.join('–')+' · B '+state.periodB.join('–'):state.period.join(' — ');
    $('coverageKpi').textContent=state.compare?'Bilans connus A / B : '+pct.format(a.count?a.knownKilled/a.count:0)+' / '+pct.format(b.count?b.knownKilled/b.count:0):pct.format(a.count?a.knownKilled/a.count:0)+' des bilans morts connus';
    $('chartStatus').textContent=state.compare?'Comparaison de deux périodes · '+M[state.metric].title:'Épaisseur = '+M[state.metric].title.toLowerCase();
    let note='Champs principaux · '+(state.percent?'% de la métrique totale à chaque niveau · ':'')+'Bilans inconnus ≠ zéro.';
    const deathsUnknown=a.count-a.knownKilled,injuriesUnknown=a.count-a.knownWounded;
    if(state.metric!=='count')note+=' '+format(state.metric==='killed'?deathsUnknown:injuriesUnknown)+' bilans inconnus en A, sans épaisseur attribuée.';
    if(graph.missingYears.length)note+=' Années absentes en A : '+graph.missingYears.join(', ')+'.';
    if(state.compare){const missingB=d3.range(state.periodB[0],state.periodB[1]+1).filter(y=>!meta.years.includes(y));if(missingB.length)note+=' Années absentes en B : '+missingB.join(', ')+'.';if(state.period[0]<=state.periodB[1]&&state.periodB[0]<=state.period[1])note+=' A et B se chevauchent : les incidents communs contribuent aux deux bandes.';}
    $('qualityNote').textContent=note;
  }
  function updateUnits() {$('absoluteButton').classList.toggle('active',!state.percent);$('percentButton').classList.toggle('active',state.percent);$('absoluteButton').setAttribute('aria-pressed',!state.percent);$('percentButton').setAttribute('aria-pressed',state.percent);if(graph){d3.selectAll(root.querySelectorAll('.label-value')).text(s=>formattedValue(s.datum.value));selectionInfo();updateStatistics();}}
  function resetFilters() {sharedWarning='';state.filters={};state.dims=presets.modus.dims.slice();state.metric='count';state.top=7;state.sort='optimized';state.percent=false;state.compare=false;defaultPeriods();selected.clear();hover=null;$('preset').value='modus';$('presetHint').textContent=presets.modus.hint;syncControls();queueQuery(0);}
  function setCollapsed(value) {if(innerWidth<=900){$('workspace').classList.toggle('mobile-open',!value);}else{$('workspace').classList.toggle('collapsed',value);$('expandButton').hidden=!value;}$('collapseButton').setAttribute('aria-expanded',!value);}
  function recenter() {svg.interrupt('zoom').transition('zoom').duration(reducedMotion?0:480).call(zoom.transform,d3.zoomIdentity);}
  function openDialog(id) {const d=$(id);if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','');}
  function closeDialog(dialog) {if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}
  function describeSource() {
    const [min,max]=bounds();$('sourceSummary').textContent=(usingBase?'GTD':'CSV importé')+' · '+min+'–'+max;$('dialogDatasetName').textContent=meta.name;
    $('dialogDatasetDetails').textContent=format(meta.incidents||meta.count)+' incidents · '+min+'–'+max+' · '+(meta.imported?'CSV importé dans ce navigateur':'Données réelles START / Kaggle');
    const missing=d3.range(min,max+1).filter(y=>!meta.years.includes(y));$('missingDataNote').textContent=missing.length?'Années absentes du fichier : '+missing.join(', ')+'. Aucun zéro n’est imputé à ces années.':'Toutes les années de la plage sont représentées dans ce fichier.';
    $('sourceLink').hidden=!!meta.imported;
  }
  async function importCSV(file) {
    if(!alive||!file||loading)return;loading=true;++querySerial;clearTimeout(queryTimeout);queryTimeout=0;$('importProgress').hidden=false;$('importError').hidden=true;$('dropZone').setAttribute('aria-busy','true');
    try {const buffer=await file.arrayBuffer();const result=await rpc('import',{buffer,filename:file.name});if(!alive)return;meta=result.meta;dicts=result.dicts;graph=null;usingBase=false;describeSource();loading=false;resetFilters();$('sharedNotice').textContent='CSV importé : exploration locale au Sankey. Les autres planches conservent leur jeu de données.';closeDialog($('dataDialog'));toast(format(meta.incidents)+' incidents importés.');}
    catch(error){$('importError').textContent=error.message;$('importError').hidden=false;}
    finally {if(!alive)return;loading=false;$('importProgress').hidden=true;$('dropZone').removeAttribute('aria-busy');$('csvInput').value='';}
  }
  function download(blob,name) {const url=URL.createObjectURL(blob),a=document.createElement('a');objectUrls.add(url);a.href=url;a.download=name;root.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);objectUrls.delete(url);},2000);}
  function exportSnapshot() {
    const clone=$('chart').cloneNode(true);clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',1280);clone.setAttribute('height',850);clone.setAttribute('viewBox','0 -55 1280 850');clone.style.cssText='';
    const namespace='http://www.w3.org/2000/svg';const rect=document.createElementNS(namespace,'rect');rect.setAttribute('x','0');rect.setAttribute('y','-55');rect.setAttribute('width','1280');rect.setAttribute('height','850');rect.setAttribute('fill','#ffffff');clone.insertBefore(rect,clone.firstChild);
    const style=document.createElementNS(namespace,'style');style.textContent='.flow path{stroke-width:.25;stroke-opacity:.35}.flow.is-dim{opacity:.065!important}.flow.is-highlight{opacity:.88!important}.node.is-dim,.node-label.is-dim{opacity:.25!important}.node .node-shape{stroke-width:.8;stroke-opacity:.8}.node.is-selected .node-shape{stroke:#fff;stroke-width:2}.node-hit{fill:transparent;stroke:none}.node-label text{font-family:Libre Franklin,Arial,sans-serif;font-size:12px;fill:#1d1d1b;paint-order:stroke;stroke:#ffffff;stroke-width:4px;stroke-linejoin:round}.node-label .label-value{font-size:9px;fill:#5f5e5a}.leader{fill:none;stroke:#718ba0;stroke-width:.7;stroke-opacity:.6}.radial-guides path{fill:none;stroke:#47617b;stroke-width:.7;stroke-opacity:.34}';clone.querySelector('defs').append(style);
    function text(x,y,value,size,color){const e=document.createElementNS(namespace,'text');e.setAttribute('x',x);e.setAttribute('y',y);e.setAttribute('font-family','Arial,sans-serif');e.setAttribute('font-size',size);e.setAttribute('fill',color);e.textContent=value;clone.append(e);}
    text(26,-25,$('scopeTitle').textContent,17,'#1d1d1b');text(26,-4,'A '+state.period.join('–')+(state.compare?' · B '+state.periodB.join('–'):'')+' · '+M[state.metric].title+' · radial '+Math.round(state.morph)+' %',10,'#5f5e5a');text(26,785,meta.name+' · Source START / Kaggle · Catégories principales · Bilans inconnus ≠ zéro',9,'#5f5e5a');
    return new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml;charset=utf-8'});
  }
  function closeExportMenu() {$('exportOptions').hidden=true;$('exportMenuButton').setAttribute('aria-expanded','false');}
  async function exportPNG() {
    closeExportMenu();if(!graph)return;
    try {await document.fonts?.ready;const blob=exportSnapshot(),url=URL.createObjectURL(blob),image=new Image();objectUrls.add(url);image.onload=()=>{if(!alive){URL.revokeObjectURL(url);return;}const canvas=document.createElement('canvas');canvas.width=2560;canvas.height=1700;const context=canvas.getContext('2d');context.drawImage(image,0,0,2560,1700);URL.revokeObjectURL(url);canvas.toBlob(out=>{if(out&&alive)download(out,'gtd-flux.png');else toast('Export PNG indisponible dans ce navigateur.');},'image/png');};image.onerror=()=>{URL.revokeObjectURL(url);if(!alive)return;toast('L’export PNG a échoué. Essayez SVG.');};image.src=url;}catch(error){toast(error.message);}
  }
  function exportCSV() {
    closeExportMenu();const neutralize=s=>/^[=+@\-\t\r]/.test(String(s))?"'"+s:s;
    const rows=graph.links.map(l=>({dimension_source:D[l.source.dim].title,categorie_source:neutralize(l.source.label),dimension_cible:D[l.target.dim].title,categorie_cible:neutralize(l.target.label),metrique:state.metric,periode_A:state.period.join('-'),valeur_A:l.a[state.metric],part_selection_A:graph.totals.a[state.metric]?l.a[state.metric]/graph.totals.a[state.metric]:0,incidents_A:l.a.count,bilans_morts_connus_A:l.a.knownKilled,bilans_blesses_connus_A:l.a.knownWounded,...(state.compare?{periode_B:state.periodB.join('-'),valeur_B:l.b[state.metric],part_selection_B:graph.totals.b[state.metric]?l.b[state.metric]/graph.totals.b[state.metric]:0,incidents_B:l.b.count}:{}),regroupement_source:l.source.cat===-1?neutralize(l.source.members.join(' | ')):'',regroupement_cible:l.target.cat===-1?neutralize(l.target.members.join(' | ')):''}));
    download(new Blob(['\uFEFF'+d3.csvFormat(rows)],{type:'text/csv;charset=utf-8'}),'gtd-flux.csv');
  }
  // All UI bindings live here; slider input never recomputes the data graph.
  for(const suffix of ['', 'B'])for(const [id,index] of [['yearStart',0],['yearEnd',1],['startRange',0],['endRange',1]])$(id+suffix).addEventListener(id.startsWith('year')?'change':'input',event=>setPeriod(index,event.target.value,!!suffix));
  $('compareToggle').addEventListener('change',event=>{state.compare=event.target.checked;syncPeriodControls();queueQuery(0);});
  $('preset').addEventListener('change',event=>{const preset=presets[event.target.value];if(!preset)return;state.dims=preset.dims.slice();$('presetHint').textContent=preset.hint;configureDimensions();queueQuery(0);});
  $('addDimension').addEventListener('click',()=>{if(state.dims.length<4){state.dims.push(Object.keys(D).find(d=>!state.dims.includes(d)));customDimensions();}});
  for(const [key,d] of Object.entries(D))if(key!=='region'&&key!=='country')$('categoryDimension').add(new Option(d.title,key));
  $('categoryDimension').value='attack';$('categoryDimension').addEventListener('change',()=>makeMultiFilter($('categoryFilter'),$('categoryDimension').value,'Catégories',dicts[$('categoryDimension').value],true));
  $('metric').addEventListener('change',event=>{state.metric=event.target.value;queueQuery(0);});
  $('topCategories').addEventListener('input',event=>{state.top=Number(event.target.value);$('topValue').textContent=state.top;queueQuery(80);});
  $('sort').addEventListener('change',event=>{state.sort=event.target.value;queueQuery(0);});
  $('absoluteButton').addEventListener('click',()=>{state.percent=false;updateUnits();});$('percentButton').addEventListener('click',()=>{state.percent=true;updateUnits();});
  $('morphSlider').addEventListener('input',event=>{animation=null;state.morph=Number(event.target.value);syncMorphUI();syncAnimateUI();requestFrame();});
  $('horizontalButton').addEventListener('click',()=>morphTo(0,1500));$('radialButton').addEventListener('click',()=>morphTo(100,1500));$('animateButton').addEventListener('click',toggleAnimation);
  $('resetButton').addEventListener('click',resetFilters);$('emptyReset').addEventListener('click',resetFilters);
  $('clearSelection').addEventListener('click',()=>{selected.clear();highlight();selectionInfo();});$('isolateButton').addEventListener('click',isolateSelection);
  $('collapseButton').addEventListener('click',()=>setCollapsed(true));$('expandButton').addEventListener('click',()=>setCollapsed(false));
  $('zoomIn').addEventListener('click',()=>svg.transition('zoom').duration(250).call(zoom.scaleBy,1.3));$('zoomOut').addEventListener('click',()=>svg.transition('zoom').duration(250).call(zoom.scaleBy,1/1.3));$('recenterButton').addEventListener('click',recenter);
  $('fullscreenButton').addEventListener('click',async()=>{try{document.fullscreenElement?await document.exitFullscreen():await root.querySelector('.chart-card').requestFullscreen();}catch{toast('Le mode plein écran n’est pas disponible.');}});
  $('helpButton').addEventListener('click',()=>openDialog('helpDialog'));
  for(const id of ['sourceButton','footerSource','importButton'])$(id).addEventListener('click',()=>openDialog('dataDialog'));
  for(const button of root.querySelectorAll('.close-dialog'))button.addEventListener('click',()=>closeDialog(button.closest('dialog')));
  for(const dialog of root.querySelectorAll('dialog'))dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closeDialog(dialog);}});
  $('dropZone').addEventListener('click',()=>$('csvInput').click());$('dropZone').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('csvInput').click();}});
  $('csvInput').addEventListener('change',event=>importCSV(event.target.files[0]));
  $('dropZone').addEventListener('dragover',event=>{event.preventDefault();$('dropZone').classList.add('dragover');});$('dropZone').addEventListener('dragleave',()=>$('dropZone').classList.remove('dragover'));$('dropZone').addEventListener('drop',event=>{event.preventDefault();$('dropZone').classList.remove('dragover');importCSV(event.dataTransfer.files[0]);});
  $('restoreData').addEventListener('click',async()=>{try{const result=await rpc('init',{dataset:baseData});if(!alive)return;meta=result.meta;dicts=result.dicts;graph=null;usingBase=true;describeSource();resetFilters();$('sharedNotice').textContent='Jeu intégré rétabli. Utilisez Reprendre la sélection commune pour rétablir son périmètre.';closeDialog($('dataDialog'));toast('Dataset GTD intégré rétabli.');}catch(error){toast(error.message);}});
  $('exportMenuButton').addEventListener('click',()=>{$('exportOptions').hidden=!$('exportOptions').hidden;$('exportMenuButton').setAttribute('aria-expanded',!$('exportOptions').hidden);});
  $('exportSVG').addEventListener('click',()=>{closeExportMenu();if(graph)download(exportSnapshot(),'gtd-flux.svg');});$('exportPNG').addEventListener('click',exportPNG);$('exportCSV').addEventListener('click',()=>{if(graph)exportCSV();});
  root.addEventListener('click',event=>{if(!event.target.closest('.export-menu'))closeExportMenu();});
  root.addEventListener('keydown',event=>{if(['INPUT','SELECT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName)||root.querySelector('dialog[open]'))return;if(event.code==='Space'){event.preventDefault();toggleAnimation();}if(event.key.toLowerCase()==='r')recenter();if(event.key==='Escape'){selected.clear();hover=null;highlight();selectionInfo();$('tooltip').hidden=true;setCollapsed(true);}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){animation=null;syncAnimateUI();}}, {signal:listeners.signal});
  describeSource();defaultPeriods();syncControls();syncMorphUI();updateFilterBadge();
  rpc('init',{dataset:baseData}).then(()=>{if(alive){sourceReady=true;queryGraph();}}).catch(()=>{if(alive){sourceReady=true;queryGraph();}});
  // A small, explicit inspection API for reproducible integration and geometry checks.
  const controller={applyShared:(incoming)=>{if(!usingBase)return false;countryGroups=incoming.countryGroups||[];sharedWarning=incoming.warning||'';state.period=incoming.period.slice();state.filters=structuredClone(incoming.filters);state.compare=!!incoming.compare;if(incoming.compare)state.periodB=incoming.compare.slice();selected.clear();syncControls();updateFilterBadge();queueQuery(0);return true;},dispose:()=>{alive=false;++querySerial;animation=null;listeners.abort();worker?.terminate();pending.clear();for(const id of timers)window.clearTimeout(id);for(const id of frames)window.cancelAnimationFrame(id);timers.clear();frames.clear();for(const url of objectUrls)URL.revokeObjectURL(url);objectUrls.clear();d3.select(root).selectAll('*').interrupt().interrupt('zoom').interrupt('glow');svg.on('.zoom',null);},getState:()=>JSON.parse(JSON.stringify(state)),getGraph:()=>graph,getSelection:()=>[...selected],query:queryGraph,importCSV,reset:resetFilters,morphTo,exportSnapshot,engine:()=>worker?'worker':'main-thread'};
  return controller;
}

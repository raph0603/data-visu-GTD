/* Compatible Bézier topology: both layouts use six cubic segments per contour.
   The radial layout independently allocates proportional angular ports, not a
   polar warp of the Cartesian layout. All stages share the same angular scale. */
export function createGeometry(shared) {
  'use strict';
  const W=1280, H=760, CX=W/2, CY=H/2+4, R=250, NODE=12, TAU=2*Math.PI;
  const palette=['#72dcca','#74b9ef','#d4b7f4','#f1bf81','#e994ad','#a5cbe3','#b7d991','#b3acf5','#86d1bd','#f0cf8a','#a7bcfa','#efb5cc'];
  function hash(s) {let v=2166136261; for(let i=0;i<s.length;i++) v=Math.imul(v^s.charCodeAt(i),16777619);return v>>>0;}
  const categoryColors={
    'Unknown':'#91a6bb','Bombing/Explosion':'#72dcca','Armed Assault':'#82bff0','Assassination':'#f0a7bb',
    'Facility/Infrastructure Attack':'#e8c288','Hostage Taking (Kidnapping)':'#b9a2ee','Hostage Taking (Barricade Incident)':'#e6a7d2','Hijacking':'#a8d697','Unarmed Assault':'#a0cbd6',
    'Explosives':'#77d9c1','Firearms':'#83bbed','Incendiary':'#f0b782','Melee':'#c1a6ee','Chemical':'#ef9fb8','Biological':'#b2d395','Radiological':'#e1bbd9',
    'Private Citizens & Property':'#77d7c1','Military':'#8bb9ef','Police':'#c3a9ee','Government (General)':'#e5a4ba','Business':'#e8bd82'
  };
  function color(node) {if(!shared)return palette[hash(node.dim+node.label)%palette.length];if(node.cat===-1||node.label==='Unknown')return shared.other;if(node.dim==='attack')return shared.attackTypes[node.label]||shared.other;return shared.categorical[hash(node.dim+node.label)%shared.categorical.length];}
  function polar(r,a) {return [CX+r*Math.cos(a),CY+r*Math.sin(a)];}
  function line(a,b) {return [a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3,a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3,...b];}
  function capLine(a,b) {const m=[(a[0]+b[0])/2,(a[1]+b[1])/2];return [...line(a,m),...line(m,b)];}
  function arc(r,a,b) {
    const p=polar(r,a),q=polar(r,b),k=4/3*Math.tan((b-a)/4)*r;
    return [p[0]-k*Math.sin(a),p[1]+k*Math.cos(a),q[0]+k*Math.sin(b),q[1]-k*Math.cos(b),...q];
  }
  function capArc(r,a,b) {const m=(a+b)/2;return [...arc(r,a,m),...arc(r,m,b)];}
  function nodeH(n) {
    const a=[n.x1,n.y0],b=[n.x1,n.y1],c=[n.x0,n.y1],d=[n.x0,n.y0];
    return [...a,...capLine(a,b),...line(b,c),...capLine(c,d),...line(d,a)];
  }
  function nodeR(n) {
    const a=polar(R,n.theta1),b=polar(R,n.theta0),c=polar(R+NODE,n.theta0),d=polar(R+NODE,n.theta1);
    return [...a,...capArc(R,n.theta1,n.theta0),...line(b,c),...capArc(R+NODE,n.theta0,n.theta1),...line(d,a)];
  }
  function linkH(l,start=0,end=1) {
    const s=l.source,t=l.target,sy=l.y0-l.width/2,ty=l.y1-l.width/2,mid=(s.x1+t.x0)/2;
    const a=[s.x1,sy+l.width*start],b=[t.x0,ty+l.width*start],c=[t.x0,ty+l.width*end],d=[s.x1,sy+l.width*end];
    return [...a,mid,a[1],mid,b[1],...b,...capLine(b,c),mid,c[1],mid,d[1],...d,...capLine(d,a)];
  }
  function linkR(l,start=0,end=1) {
    const sa=l.rs1-(l.rs1-l.rs0)*start,sb=l.rs1-(l.rs1-l.rs0)*end,ta=l.rt0+(l.rt1-l.rt0)*start,tb=l.rt0+(l.rt1-l.rt0)*end;
    const a=polar(R,sa),b=polar(R,ta),c=polar(R,tb),d=polar(R,sb),c1=polar(R*.25,sa),c2=polar(R*.25,ta),c3=polar(R*.25,tb),c4=polar(R*.25,sb);
    return [...a,...c1,...c2,...b,...capArc(R,ta,tb),...c3,...c4,...d,...capArc(R,sb,sa)];
  }
  function path(v) {let p='M'+round(v[0])+','+round(v[1]);for(let i=2;i<v.length;i+=6)p+='C'+v.slice(i,i+6).map(round).join(',');return p+'Z';}
  function round(v) {return Math.round(v*100)/100;}
  function collapse(v) {let x=0,y=0;for(let i=0;i<v.length;i+=2){x+=v[i];y+=v[i+1];}x/=v.length/2;y/=v.length/2;return v.map((_,i)=>i%2?y:x);}
  function layout(graph, settings, d3, translate=s=>s) {
    if(!graph.nodes.length || !graph.links.length || !(graph.total>0)) return {...graph,nodes:[],links:[],guides:[]};
    const nodes=graph.nodes.map(n=>({...n,color:color(n)})),links=graph.links.map(l=>({...l}));
    const sankey=d3.sankey().nodeId(n=>n.id).nodeAlign(n=>n.stage).nodeWidth(NODE).nodePadding(17).extent([[186,95],[1084,673]]).iterations(32);
    if(settings.sort==='value') sankey.nodeSort((a,b)=>b.value-a.value||a.label.localeCompare(b.label));
    else if(settings.sort==='alpha') sankey.nodeSort((a,b)=>translate(a.label).localeCompare(translate(b.label),'fr'));
    const built=sankey({nodes,links});
    const columns=settings.dims.map((dim,stage)=>nodes.filter(n=>n.stage===stage).sort((a,b)=>a.y0-b.y0));
    const sector=TAU/columns.length,gap=.022,stageGap=.21,maxN=Math.max(...columns.map(c=>c.length));
    const angularScale=(sector-stageGap-(maxN-1)*gap)/graph.total;
    const guides=[];
    columns.forEach((column,stage)=>{
      const center=-Math.PI/2+stage*sector;
      const occupied=graph.total*angularScale+(column.length-1)*gap;
      let theta=center-occupied/2;
      for(const n of column) {n.theta0=theta;n.theta1=theta+n.value*angularScale;n.thetaCenter=(n.theta0+n.theta1)/2;theta=n.theta1+gap;}
      guides.push({stage,center,start:center-sector/2+.04,end:center+sector/2-.04});
    });
    for(const n of nodes) {
      const outgoing=[...n.sourceLinks].sort((a,b)=>a.target.thetaCenter-b.target.thetaCenter),incoming=[...n.targetLinks].sort((a,b)=>a.source.thetaCenter-b.source.thetaCenter);
      let cursor=n.theta0;for(const l of outgoing){l.rs0=cursor;l.rs1=cursor+l.value*angularScale;cursor=l.rs1;}
      cursor=n.theta0;for(const l of incoming){l.rt0=cursor;l.rt1=cursor+l.value*angularScale;cursor=l.rt1;}
      n.h=nodeH(n);n.r=nodeR(n);
      const label=translate(n.label);n.text=label;n.short=label.length>25?label.slice(0,24)+'…':label;n.labelWidth=Math.min(165,n.short.length*6.3);
      n.labelH=[n.stage===0?n.x0-16-n.labelWidth:n.x1+13,(n.y0+n.y1)/2-3];
      const p=polar(R+24,n.thetaCenter);n.right=Math.cos(n.thetaCenter)>=0;n.labelIdeal=p[1];
      n.radialAnchor=p;n.nodeCenterH=[(n.x0+n.x1)/2,(n.y0+n.y1)/2];n.nodeCenterR=polar(R+NODE/2,n.thetaCenter);
    }
    for(const right of [false,true]) {
      const side=nodes.filter(n=>n.right===right).sort((a,b)=>a.labelIdeal-b.labelIdeal);
      const minGap=settings.top>9?19:29;let last=65-minGap;
      for(const n of side){n.labelY=Math.max(n.labelIdeal,last+minGap);last=n.labelY;}
      if(last>688){let limit=688;for(let i=side.length-1;i>=0;i--){side[i].labelY=Math.min(side[i].labelY,limit);limit=side[i].labelY-minGap;}}
      for(const n of side){n.labelR=[right?CX+R+65:CX-R-65-n.labelWidth,n.labelY];n.leaderR=[...n.radialAnchor,right?CX+R+45:CX-R-45,n.labelY-3,right?n.labelR[0]-7:n.labelR[0]+n.labelWidth+7,n.labelY-3];}
    }
    for(const l of links) {
      l.h=linkH(l);l.r=linkR(l);l.fraction=graph.total?l.value/graph.total:0;
      l.ratioA=l.value?l.a[settings.metric]/l.value:0;
      l.ah=linkH(l,0,l.ratioA);l.ar=linkR(l,0,l.ratioA);l.bh=linkH(l,l.ratioA,1);l.br=linkR(l,l.ratioA,1);
      l.gradient=[l.source.x1,l.y0,l.target.x0,l.y1];l.gradientR=[...polar(R,(l.rs0+l.rs1)/2),...polar(R,(l.rt0+l.rt1)/2)];
    }
    return {...graph,...built,guides,angularScale};
  }
  function resolveLabels(items,t) {
    const labels=items.map(s=>({id:s.id,x:s.h[0]+(s.r[0]-s.h[0])*t,y:s.h[1]+(s.r[1]-s.h[1])*t,width:s.width,height:s.hasValue?(t>.12&&t<.88?19:30):19}));
    labels.sort((a,b)=>a.y-b.y||a.x-b.x);
    const overlaps=(a,b)=>a.x<b.x+b.width+9&&b.x<a.x+a.width+9;
    for(let i=0;i<labels.length;i++){const a=labels[i];for(let j=0;j<i;j++){const b=labels[j];if(overlaps(a,b))a.y=Math.max(a.y,b.y+b.height);}}
    for(let i=labels.length-1;i>=0;i--){const a=labels[i];a.y=Math.min(a.y,690);for(let j=i+1;j<labels.length;j++){const b=labels[j];if(overlaps(a,b))a.y=Math.min(a.y,b.y-a.height);}}
    return new Map(labels.map(l=>[l.id,[l.x,l.y]]));
  }
  return {W,H,CX,CY,R,NODE,palette,color,polar,path,collapse,layout,linkH,linkR,nodeH,nodeR,resolveLabels};
}

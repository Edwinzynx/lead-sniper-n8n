// Usage: node scripts/recreate-drawio.cjs <export-directory> <elkjs-module-path>
// Only names, node types, notes and connection topology are exported. No credentials or code.
const fs = require('node:fs');
const path = require('node:path');
const ELK = require(process.argv[3] || 'elkjs');
const elk = new ELK();
const source = process.argv[2];
if (!source) throw new Error('Pass the n8n export directory.');
const output = path.resolve(__dirname, '../drawio');
fs.mkdirSync(output, { recursive: true });
const selected = [
  ['WVgWzYjdocSVykA1', '01-main', 'Main Coordinator'],
  ['zr7r7pAD75jubSVE', '02-setup', 'Setup and Preflight'],
  ['StdyHUjdCpc6chmu', '03-discovery', 'Discover One Page'],
  ['UNuafhjltTtQgskT', '04-process-lead', 'Process Lead'],
  ['wRzekCTIYvCpuZGc', '05-errors', 'Record Errors'],
];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const colors = {step:['#dae8fc','#6c8ebf'], data:['#d5e8d4','#82b366'], decision:['#fff2cc','#d6b656'], special:['#e1d5e7','#9673a6']};
function appearance(node) {
  const type = node.type.split('.').pop();
  if (type === 'if') return ['decision','rhombus;',220,100];
  if (type === 'dataTable') return ['data','shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=12;',210,80];
  if (type.endsWith('Trigger')) return ['special','rounded=1;arcSize=50;',210,70];
  if (type === 'executeWorkflow') return ['special','shape=process;',210,70];
  if (type === 'splitInBatches') return ['special','shape=hexagon;',210,80];
  if (type === 'lmChatOpenAi' || type === 'chainLlm') return ['special','rounded=1;',210,70];
  return ['step','rounded=1;arcSize=12;',210,70];
}
function connections(d, ids) {
  const list=[];
  for (const [name, channels] of Object.entries(d.connections)) {
    const node=d.nodes.find(n=>n.name===name);
    for (const [channel, outputs] of Object.entries(channels)) outputs.forEach((targets, port)=> {
      for (const target of targets) {
        if (!ids.has(name) || !ids.has(target.node)) throw new Error('Unknown edge endpoint');
        let label='';
        if (channel !== 'main') label=channel==='ai_languageModel'?'AI model':channel;
        else if (node.type.endsWith('.if')) label=port===0?'true':'false';
        else if (node.type.endsWith('.splitInBatches')) label=port===0?'done':'loop';
        else if (port>0 && node.onError==='continueErrorOutput') label='error';
        else if (outputs.length>1) label=port===0?'success':`output ${port}`;
        list.push({id:`e${list.length}`,sources:[ids.get(name)],targets:[ids.get(target.node)],label,channel,port,targetPort:target.index});
      }
    });
  }
  return list;
}
(async()=>{
  const pages=[], manifest=[];
  for (const [workflowId, stem, title] of selected) {
    const file=fs.readdirSync(source).find(f=>f.startsWith(workflowId+'-')&&f.endsWith('.json'));
    if (!file) throw new Error(`Missing ${workflowId}`);
    const d=JSON.parse(fs.readFileSync(path.join(source,file),'utf8').replace(/^\uFEFF/,''));
    const ids=new Map(d.nodes.map((n,i)=>[n.name,`n${i}`]));
    const nodes=d.nodes.filter(n=>!n.type.endsWith('.stickyNote'));
    const notes=d.nodes.filter(n=>n.type.endsWith('.stickyNote'));
    const edges=connections(d,ids);
    const layout=await elk.layout({id:'root',layoutOptions:{
      'elk.algorithm':'layered','elk.direction':'DOWN','elk.edgeRouting':'ORTHOGONAL',
      'elk.spacing.nodeNode':'65','elk.layered.spacing.nodeNodeBetweenLayers':'75',
      'elk.layered.nodePlacement.strategy':'NETWORK_SIMPLEX',
      'elk.padding':'[top=20,left=20,bottom=20,right=20]'
    },children:nodes.map(n=>{const [,,width,height]=appearance(n);return {id:ids.get(n.name),width,height};}),
      edges:edges.map(e=>({id:e.id,sources:e.sources,targets:e.targets}))});
    const positions=new Map(layout.children.map(n=>[n.id,n]));
    const width=Math.max(layout.width+80,820);
    let noteY=layout.height+150;
    const cells=['<mxCell id="0"/>','<mxCell id="1" parent="0"/>'];
    const vertex=(id,label,style,x,y,w,h,extra='')=>cells.push(`<mxCell id="${id}" value="${esc(label)}" style="${style}html=1;whiteSpace=wrap;" vertex="1" parent="1" ${extra}><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`);
    vertex('title',title,'text;fontSize=24;fontStyle=1;align=left;',40,20,width-80,40);
    vertex('legend','Blue: processing · Green: tables · Yellow: decisions / notes · Purple: triggers, loops, child workflows and AI<br>Solid arrows: execution · Dashed arrows: AI model connection · Unconnected outputs remain unconnected as exported.', 'text;fontSize=14;align=left;',40,65,width-80,55);
    for(const n of nodes){
      const p=positions.get(ids.get(n.name)); const [role,shape,w,h]=appearance(n); const [fill,stroke]=colors[role];
      vertex(ids.get(n.name),n.name,`${shape}fontSize=16;fillColor=${fill};strokeColor=${stroke};strokeWidth=2;`,p.x+40,p.y+130,w,h);
    }
    for(const e of edges){
      const dependency=e.channel!=='main';
      cells.push(`<mxCell id="${e.id}" value="${esc(e.label)}" source="${e.sources[0]}" target="${e.targets[0]}" edge="1" parent="1" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;fontSize=13;labelBackgroundColor=#ffffff;strokeWidth=1.5;strokeColor=${e.label==='error'?'#b85450':'#64748b'};endArrow=block;${dependency?'dashed=1;':''}" connectionType="${esc(e.channel)}" sourceOutput="${e.port}" targetInput="${e.targetPort}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
    }
    for(const n of notes){
      const content=n.parameters.content||'';
      const h=Math.max(150,Math.ceil(content.length/95)*24+65);
      vertex(ids.get(n.name),`<b>${esc(n.name)} — source annotation</b><br>${esc(content).replace(/\n/g,'<br>')}`,'rounded=1;align=left;verticalAlign=top;spacing=16;fontSize=14;fillColor=#fff2cc;strokeColor=#d6b656;',40,noteY,width-80,h);
      noteY+=h+25;
    }
    const model=`<mxGraphModel adaptiveColors="auto" grid="1" gridSize="10" page="0" pageWidth="${Math.ceil(width)}" pageHeight="${Math.ceil(noteY+40)}"><root>${cells.join('')}</root></mxGraphModel>`;
    const page=`<diagram id="${workflowId}" name="${esc(title)}">${model}</diagram>`;
    pages.push(page);
    fs.writeFileSync(path.join(output,stem+'.drawio'),`<mxfile host="app.diagrams.net">${page}</mxfile>`);
    fs.writeFileSync(path.join(output,stem+'.xml'),model);
    manifest.push({file:stem+'.drawio',source:file,title,nodes:d.nodes.length,executionNodes:nodes.length,notes:notes.length,connections:edges.length});
  }
  fs.writeFileSync(path.join(output,'Lead-Sniper-Workflows.drawio'),`<mxfile host="app.diagrams.net">${pages.join('')}</mxfile>`);
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify(manifest,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});

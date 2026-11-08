import * as d3 from 'd3';
import GTDCore from './engine.js';
let data;
self.onmessage = function ({data: message}) {
  const {id, type} = message;
  try {
    if (type === 'init') {data = message.dataset; self.postMessage({id, type, meta:data.meta, dicts:data.dicts});}
    else if (type === 'import') {
      let text; try {text = new TextDecoder('utf-8', {fatal:true}).decode(message.buffer);} catch {text = new TextDecoder('windows-1252').decode(message.buffer);}
      const parsed = GTDCore.parseCSV(text, d3, message.filename); data = parsed;
      self.postMessage({id, type, meta:data.meta, dicts:data.dicts});
    } else if (type === 'query') {if (!data) throw new Error('Dataset non chargé.'); self.postMessage({id, type, graph:GTDCore.aggregate(data, message.settings)});}
  } catch (error) {self.postMessage({id, type:'error', requestType:type, error:error.message});}
};

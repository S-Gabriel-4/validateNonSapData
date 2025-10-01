class CsvRowCounter extends HTMLElement {
  constructor(){
    super();
    const s=this.attachShadow({mode:'open'});
    s.innerHTML=`
      <style>
        :host{display:block;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
        .card{border:1px solid #ddd;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
        .row{display:flex;gap:8px;align-items:center}
        .drop{border:2px dashed #bbb;border-radius:12px;padding:18px;margin-top:10px;text-align:center}
        .drop.drag{border-color:#666;background:#fafafa}
        .muted{color:#666;font-size:12px}.big{font-size:22px;font-weight:700;margin:8px 0 0}
      </style>
      <div class="card">
        <div class="row">
          <input id="file" type="file" accept=".csv,.txt" />
          <span id="fname" class="muted"></span>
        </div>
        <div id="drop" class="drop">CSV hierher ziehen</div>
        <div><div class="muted">Zeilen im File (ohne Header):</div><div id="count" class="big">0</div></div>
      </div>`;
    this._els={file:s.getElementById('file'),drop:s.getElementById('drop'),count:s.getElementById('count'),fname:s.getElementById('fname')};

    // NEW: Speicher für Duplikate
    this._dupCount = 0;
    this._dups = []; // Array von { invoiceNumber, invoicePosition, count }
  }

  connectedCallback(){
    const f=this._els.file,d=this._els.drop;
    f.addEventListener('change',()=>this._read(f.files&&f.files[0]));
    d.addEventListener('dragover',e=>{e.preventDefault();d.classList.add('drag')});
    d.addEventListener('dragleave',()=>d.classList.remove('drag'));
    d.addEventListener('drop',e=>{e.preventDefault();d.classList.remove('drag');this._read(e.dataTransfer.files&&e.dataTransfer.files[0])});
  }

  _emitProps(changes){ this.dispatchEvent(new CustomEvent('propertiesChanged',{detail:{properties:changes}})); }

  _read(file){
    if(!file) return;
    this._els.fname.textContent=file.name;
    const r=new FileReader();
    r.onload=e=>{
      const text=e.target.result;
      const n=this._count(text);
      this._els.count.textContent=String(n);

      // NEW: Duplikate scannen
      this._scanDuplicates(text);
      this.dispatchEvent(new CustomEvent('duplicatesFound', { detail: { count: this._dupCount, pairs: this._dups } }));

      this._emitProps({ rowCount: n, fileName: file.name });
      this.dispatchEvent(new CustomEvent('fileLoaded', { detail: { rowCount: n, fileName: file.name } }));
    };
    r.readAsText(file);
  }

  _count(text){
    const lines=text.split(/\r\n|\n|\r/);
    let i=0; while(i<lines.length && lines[i].trim()==="") i++;
    if(i>=lines.length) return 0;
    let c=0; for(let j=i+1;j<lines.length;j++){ if(lines[j].trim()!=="") c++; }
    return c;
  }

  // NEW: leichter CSV-Parser + Duplikate auf (InvoiceNumber, InvoicePosition)
  _scanDuplicates(text){
    this._dupCount = 0;
    this._dups = [];

    const lines = text.split(/\r\n|\n|\r/);
    let i=0; while(i<lines.length && lines[i].trim()==="") i++;
    if(i>=lines.length) return;

    // Delimiter auto-detect
    const cand = [';', ',', '\t', '|'];
    const counts = cand.map(d => (lines[i].match(new RegExp("\\"+d,"g"))||[]).length);
    let delim = ','; let max = -1;
    for (let k=0;k<cand.length;k++){ if(counts[k]>max){ max=counts[k]; delim=cand[k]; } }

    const parseRow = (line) => {
      // splitter mit Quote-Unterstützung (einfach & schnell)
      const out=[]; let cur=''; let inQ=false;
      for(let p=0;p<line.length;p++){
        const ch=line[p];
        if(ch === '"'){
          if(inQ && line[p+1]==='"'){ cur+='"'; p++; } else { inQ=!inQ; }
        }else if(ch===delim && !inQ){
          out.push(cur); cur='';
        }else{
          cur+=ch;
        }
      }
      out.push(cur);
      return out;
    };

    const header = parseRow(lines[i]).map(s=>s.trim());
    const norm = s => s.toLowerCase().replace(/[\s_]+/g,''); // invoice number → invoicenumber
    const idxInv = header.findIndex(h => ['invoicenumber','invoice#','invoiceid','invoice_no','invoice'].includes(norm(h)));
    const idxPos = header.findIndex(h => ['invoicepositionnumber','invoiceposition','positionnumber','positionno','pos'].includes(norm(h)));

    if (idxInv < 0 || idxPos < 0) {
      // keine Spalten gefunden – still bleiben; optional: Event werfen
      return;
    }

    const seen = Object.create(null);
    const dupMap = Object.create(null);

    for(let r=i+1;r<lines.length;r++){
      const raw = lines[r];
      if(!raw || !raw.trim()) continue;
      const cols = parseRow(raw);
      const inv = (cols[idxInv] || '').trim();
      const pos = (cols[idxPos] || '').trim();
      if(!inv && !pos) continue;

      const key = inv + '|' + pos;
      if (seen[key] == null){
        seen[key] = 1;
      } else {
        seen[key] += 1;
        dupMap[key] = (dupMap[key] || seen[key]); // letzter Stand (>=2)
      }
    }

    // in Array überführen
    const dups = [];
    for (const k in dupMap){
      const c = seen[k];
      if (c >= 2){
        const [invoiceNumber, invoicePosition] = k.split('|');
        dups.push({ invoiceNumber, invoicePosition, count: c });
      }
    }

    this._dups = dups;
    this._dupCount = dups.length;
  }

  // --- vorhandene Methoden ---
  getRowCount(){
    return this._els.count.textContent ? parseInt(this._els.count.textContent, 10) : 0;
  }
  getFileName(){
    return this._els.fname.textContent || "";
  }

  // NEW: Methoden für Duplikate (Story-Aufruf)
  getDuplicateCount(){
    return this._dupCount || 0;
  }
  getDuplicatePairs(){
    return Array.isArray(this._dups) ? this._dups.slice() : [];
  }
  getDuplicatePairsJson(){
    try { return JSON.stringify(this.getDuplicatePairs()); } catch(e){ return "[]"; }
  }
}
customElements.define('csv-row-counter', CsvRowCounter);

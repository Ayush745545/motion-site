() => {
  const trim = value => String(value).slice(0, 240);
  const visible = el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0;
  };
  const nodes = [document.documentElement, document.body, ...document.querySelectorAll('body *')].filter(Boolean).slice(0, 5000).filter(visible);
  const colors = new Map(), fonts = new Map(), headings = new Map(), motions = new Map();
  const counts = {hero: 0, navigation: 0, card: 0, grid: 0, section: 0, button: 0};
  const colorCache = new Map();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', {willReadFrequently:true});
  const rgb = value => {
    if (colorCache.has(value)) return colorCache.get(value);
    let rgba;
    const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (match) rgba = [...match.slice(1,4).map(Number), match[4] === undefined ? 255 : Number(match[4])*255];
    else if (context) {
      context.clearRect(0,0,1,1); context.fillStyle='transparent'; context.fillStyle=value;
      context.fillRect(0,0,1,1); rgba=Array.from(context.getImageData(0,0,1,1).data);
    }
    const hex = !rgba || rgba[3]<128 ? null : '#'+rgba.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');
    colorCache.set(value,hex); return hex;
  };
  function color(value, role) {
    const hex = rgb(value); if (!hex) return;
    const key = role + hex; const item = colors.get(key) || {value: hex, role, count: 0};
    item.count++; colors.set(key, item);
  }
  let occupied = 0;
  const hero = document.querySelector('main > section, [class*="hero"], [id*="hero"], main');
  for (const el of nodes) {
    const s = getComputedStyle(el), rect = el.getBoundingClientRect();
    color(s.backgroundColor, 'background');
    const hasText = Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (hasText) {
      color(s.color, 'text');
      const family = trim(s.fontFamily), size = trim(s.fontSize), weight = trim(s.fontWeight);
      const key = [family,size,weight].join('|');
      let available = false; try { available = document.fonts.check(`${size} ${family.split(',')[0]}`); } catch { /* invalid font declaration */ }
      const item = fonts.get(key) || {family,size,weight,count:0,available}; item.count++; fonts.set(key,item);
      occupied += Math.max(0, Math.min(rect.right,1440) - Math.max(rect.left,0)) * Math.max(0,Math.min(rect.bottom,900)-Math.max(rect.top,0));
    }
    if (/^H[1-6]$/.test(el.tagName)) {
      const level = Number(el.tagName[1]), item = headings.get(level) || {level,count:0,sizes:[]};
      item.count++; if (!item.sizes.includes(s.fontSize) && item.sizes.length<30) item.sizes.push(trim(s.fontSize)); headings.set(level,item);
    }
    const button = el.matches('button, [role="button"], input[type="submit"], a[class*="button"], a[class*="btn"]');
    if (button) { counts.button++; color(s.backgroundColor,'primary'); }
    if (el.matches('a')) color(s.color,'accent');
    if (el.matches('nav, [role="navigation"]')) counts.navigation++;
    if (s.display.includes('grid')) counts.grid++;
    if (el.matches('section, main > article')) counts.section++;
    if (el.matches('[class*="card"], [class*="tile"]')) counts.card++;
    if (el === hero) counts.hero++;
    if (s.animationName !== 'none' || s.transform !== 'none' || s.transitionDuration.split(',').some(d => parseFloat(d)>0)) {
      const item = {transition:trim(s.transitionProperty),transition_duration:trim(s.transitionDuration),animation:trim(s.animationName),animation_duration:trim(s.animationDuration),timing:trim(`${s.transitionTimingFunction}; ${s.animationTimingFunction}`),transform:trim(s.transform),count:0};
      const key=JSON.stringify(item); const current=motions.get(key)||item; current.count++; motions.set(key,current);
    }
  }
  const assets = [];
  function asset(el, source, width, height, background=false) {
    if (assets.length>=60) return;
    try {
      const u = new URL(source, el.baseURI); if (!['http:','https:'].includes(u.protocol)) return;
      u.search=''; u.hash=''; u.username=''; u.password='';
      const logo = /logo|brand/i.test(`${el.alt || ''} ${el.className} ${el.id} ${u.pathname}`);
      assets.push({url:u.href,kind:logo?'logo_candidate':hero?.contains(el)?'hero_illustration':'visible_image',width:Math.min(Math.round(width),100000),height:Math.min(Math.round(height),100000),confidence:logo?0.7:background?0.6:0.8});
    } catch { /* not a public media reference */ }
  }
  for (const el of nodes) {
    if (el.tagName==='IMG') asset(el,el.currentSrc || el.src,el.naturalWidth,el.naturalHeight);
    const rect=el.getBoundingClientRect();
    for (const match of getComputedStyle(el).backgroundImage.matchAll(/url\(["']?(.*?)["']?\)/g)) asset(el,match[1],rect.width,rect.height,true);
    if (assets.length>=60) break;
  }
  const palette=[];
  for (const role of ['background','text','primary','accent']) {
    const items=Array.from(colors.values()).filter(c=>c.role===role), total=items.reduce((n,c)=>n+c.count,0);
    palette.push(...items.sort((a,b)=>b.count-a.count).slice(0,12).map(c=>({...c,frequency:c.count/total,confidence:role==='primary'||role==='accent'?0.65:0.9})));
  }
  const publicText = selector => nodes.filter(el=>el.matches(selector) && !el.closest('form, [contenteditable], [data-private]')).map(el=>{
    const clone=el.cloneNode(true); clone.querySelectorAll('input,textarea,select,script,style,[contenteditable],[data-private]').forEach(item=>item.remove());
    return trim(clone.textContent.replace(/\s+/g,' ').trim());
  }).filter(Boolean);
  const content={title:String(document.title).slice(0,160),headings:[...new Set(publicText('h1,h2,h3'))].slice(0,12),paragraphs:[...new Set(publicText('p'))].slice(0,12),ctas:[...new Set(publicText('button,a').filter(text=>/start|shop|contact|download|explore|book|view|learn|try|get/i.test(text)))].slice(0,8)};
  return {content,palette, typography:{fonts:Array.from(fonts.values()).sort((a,b)=>b.count-a.count).slice(0,60),headings:Array.from(headings.values()).sort((a,b)=>a.level-b.level),confidence:nodes.length?0.8:0},layout:{features:Object.entries(counts).map(([kind,count])=>({kind,count,confidence:kind==='hero'||kind==='card'?0.6:0.9})),visual_density:Math.min(1,occupied/(1440*900)),sampled_elements:nodes.length,confidence:0.65},motion:Array.from(motions.values()).slice(0,60),assets,confidence:nodes.length?0.7:0,warnings:['CSS properties at capture time only; JavaScript animation behavior was not analyzed.','Layout, primary colors and logo candidates are heuristics; density is viewport text-box coverage.','Font availability is a browser check, not proof of the exact rendered font.']};
}

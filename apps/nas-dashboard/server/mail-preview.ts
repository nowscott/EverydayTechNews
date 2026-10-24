import { load } from 'cheerio/slim';
import { redact } from './security.ts';

export const PREVIEW_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox";
const allowed = new Set('div span p a table tbody thead tfoot tr td th colgroup col caption h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code br hr strong b em i u s small center section article main'.split(' '));
const attrs = new Set('style class title dir lang align valign width height bgcolor border cellpadding cellspacing colspan rowspan role'.split(' '));
function safeCss(css: string): string {
  const value = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Preserve typography, table layout and responsive email rules. Network and
  // executable CSS is additionally blocked by the preview's independent CSP.
  return /url\s*\(|expression\s*\(|javascript:|[\\<>]|@(?!media\b)/i.test(value) ? '' : value;
}
export function sanitizeEmail(html: string): string {
  if (Buffer.byteLength(html)>2*1024*1024) throw Error('preview_too_large');
  const $ = load(html.replace(/<!--[\s\S]*?-->/g,''), {xml:{xmlMode:false,decodeEntities:true}});
  $('script,iframe,frame,frameset,object,embed,form,input,button,textarea,select,link,base,meta,svg,math,audio,video,source,template,noscript').remove();
  const styles = $('style').toArray().map(el=>safeCss($(el).text())).filter(Boolean); $('style').remove();
  $('img').each((_i,el)=>{const alt=$(el).attr('alt');$(el).replaceWith(alt?$('<span>').text(alt):'');});
  $('*').toArray().reverse().forEach(el=>{
    if(!('tagName' in el)||!('attribs' in el))return;
    const tag=el.tagName.toLowerCase();if(!tag||['html','head','body'].includes(tag))return;
    if(!allowed.has(tag)){ $(el).replaceWith($(el).contents());return; }
    for(const name of Object.keys(el.attribs??{})) {
      if(!attrs.has(name.toLowerCase()))$(el).removeAttr(name);
      else if(name==='style') {const css=safeCss($(el).attr(name)??'');if(css)$(el).attr(name,css);else $(el).removeAttr(name);}
    }
    if(tag==='a')$(el).attr('aria-disabled','true').attr('tabindex','-1');
  });
  const bodyStyle=safeCss($('body').attr('style')??'');
  const escapedBodyStyle=bodyStyle.replace(/[&"<>]/g,c=>({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]!));
  const content = redact($.html($('body').length?$('body').contents():$.root().contents()))
    .replace(/([?&](?:[a-z_]*(?:token|secret|signature)|key)=)[^\s&"'<>]+/gi,'$1[已隐藏]');
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+styles.map(s=>'<style>'+s+'</style>').join('')+'</head><body'+(escapedBodyStyle?' style="'+escapedBodyStyle+'"':'')+'>'+content+'</body></html>';
}

export const SETTINGS_KEY='nativeLongshot.settings.v1';
export interface Settings { prompts:boolean; latex:boolean; widthEnabled:boolean; width:number; timeline:boolean; timelineStyle:'ruler'|'compact'|'dots'; timelineSmooth:boolean; theme:'auto'|'light'|'dark' }
export const DEFAULT_SETTINGS:Settings={prompts:true,latex:true,widthEnabled:false,width:85,timeline:false,timelineStyle:'compact',timelineSmooth:true,theme:'auto'};
export function readSettings(value:unknown):Settings {
  const v=value&&typeof value==='object'?value as Record<string,unknown>:{};
  return {prompts:typeof v.prompts==='boolean'?v.prompts:true,latex:typeof v.latex==='boolean'?v.latex:true,
    widthEnabled:v.widthEnabled===true,width:typeof v.width==='number'&&Number.isFinite(v.width)?Math.max(50,Math.min(100,Math.round(v.width))):85,
    timeline:v.timeline===true,timelineStyle:v.timelineStyle==='ruler'||v.timelineStyle==='dots'?v.timelineStyle:'compact',timelineSmooth:v.timelineSmooth!==false,theme:v.theme==='light'||v.theme==='dark'?v.theme:'auto'};
}

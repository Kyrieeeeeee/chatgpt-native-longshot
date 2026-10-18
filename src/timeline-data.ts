/** Stable hashed identifiers are only fallbacks when the renderer has no ID. */
export function textHash(text:string):string{
 let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(36);
}
export function indexAt(offsets:number[],position:number):number{
 let low=0,high=offsets.length-1;
 while(low<high){const mid=Math.ceil((low+high)/2);if(offsets[mid]!<=position)low=mid;else high=mid-1;}return low;
}
export function nearestIndex(offsets:number[],position:number):number{
 const before=indexAt(offsets,position),after=Math.min(before+1,offsets.length-1);
 return position-offsets[before]!<=offsets[after]!-position?before:after;
}

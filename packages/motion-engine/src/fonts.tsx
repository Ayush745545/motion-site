import { useEffect, useState } from "react";
import { continueRender, delayRender, cancelRender, staticFile } from "remotion";
import type { Brand } from "./schema";
export const FONT_NAMES={sans:"Motion Inter",serif:"Motion Lora",mono:"Motion Plex"};
const loaded=new Map<string,Promise<FontFace>>();
export function useCompositionFont(brand:Pick<Brand,"font"|"fontWeight">){
  const key=`${brand.font}-${brand.fontWeight}`;
  const [handle]=useState(()=>delayRender("Loading bundled composition font"));
  useEffect(()=>{
    let promise=loaded.get(key);
    if(!promise){const face=new FontFace(FONT_NAMES[brand.font],`url("${staticFile(`motion/fonts/${key}.woff2`)}")`,{weight:String(brand.fontWeight)});promise=face.load().then(font=>{document.fonts.add(font);return font;});loaded.set(key,promise);}
    promise.then(()=>continueRender(handle)).catch(error=>cancelRender(error));
  },[key,brand.font,brand.fontWeight,handle]);
  return FONT_NAMES[brand.font];
}

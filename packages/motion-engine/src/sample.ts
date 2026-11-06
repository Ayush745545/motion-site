import sampleDNA from "./sample-dna.json";
import { normalizeDNA, type MotionConfig, type VideoDraft } from "./schema";
export { sampleDNA };
export const sampleDraft:VideoDraft={template:"cinematic",format:"landscape",brandName:"Atlas",tagline:"A clearer space for your next big idea.",features:[{title:"Find your focus",description:"Bring your ideas together in one beautifully simple workspace."},{title:"Move as one",description:"Keep the whole team connected, from first thought to final detail."},{title:"Make it happen",description:"Turn a little momentum into something extraordinary."}],cta:"Your next chapter starts here.",website:"atlas.example"};
export const sampleConfig:MotionConfig={...sampleDraft,brand:normalizeDNA(sampleDNA),screenshot:"sample",provenance:"sample"};

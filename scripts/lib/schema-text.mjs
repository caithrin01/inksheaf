// Model notes and reasons are explanations, not data. An answer that runs past
// the limit is clipped rather than rejected, so an otherwise valid verdict is
// not lost and re-paid. The JSON schema sent to the model is unchanged.
import {z} from 'zod';
export const clippedText=(max,min=0)=>z.preprocess(v=>typeof v==='string'&&v.length>max?v.slice(0,max-1).trimEnd()+'…':v,z.string().min(min).max(max));

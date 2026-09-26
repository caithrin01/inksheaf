import {z} from 'zod';
import {MIN_LETTER_POINTS} from './figure-lettering.mjs';

// Fidelity, reading scale and orientation are distinct observations. In
// particular, an unchanged bitmap says nothing about the size of its labels.
export const FigureConfirmation=z.object({
  confirmed:z.boolean(),origin:z.enum(['rendered_layout','source_content','uncertain']),note:z.string().max(200),
  figure_id:z.string().nullable(),
  defect:z.enum(['reading_size','crop','caption','missing','orientation_only','none','uncertain']),
  reading_detail:z.enum(['small_text','large_labels','picture','uncertain']),
});

export function figurePrintEvidence(figures){
  return figures.map(f=>({id:f.id,width_points:f.w??null,height_points:f.h??null,
    image_width_points:f.image_width_points??null,reading_mode:f.reading_mode??null,...(Number.isFinite(f.letter_points)?{letter_points:f.letter_points}:{}),
    ...(f.detail_pages?{enlarged_detail_pages:f.detail_pages}:{}),...(f.parent_id?{overview_page:f.overview_page,detail_index:f.detail_index,detail_total:f.detail_total}:{}),
    reading_sizes:(f.reading_sizes||[]).map(({mode,image_width_points,width_points,height_points,letter_points})=>({mode,image_width_points,width_points,height_points,...(Number.isFinite(letter_points)?{letter_points}:{})}))}));
}

export function adjudicateFigureConfirmation(answer,figures){
  const result=FigureConfirmation.parse(answer),figure=figures.find(f=>f.id===result.figure_id);
  const changed=(fields)=>({...result,...fields,model_confirmation:result});
  if(!figure||result.defect==='uncertain'||result.reading_detail==='uncertain'||result.origin==='uncertain')
    return changed({confirmed:true,origin:'uncertain'});
  if(result.reading_detail==='small_text'&&['reading_size','orientation_only','none'].includes(result.defect)
    &&(!Number.isFinite(figure.image_width_points)||figure.image_width_points<=0||!figure.reading_sizes?.length))
    return changed({confirmed:true,origin:'uncertain'});
  // Fine text needs the largest bounded reading setting, even when a zoomed
  // raster makes it appear legible. This is a layout policy, not a readability
  // certificate: the enlarged PDF must still pass visual review.
  const larger=(figure.reading_sizes||[]).filter(s=>['column','landscape'].includes(s.mode)
    &&[s.image_width_points,s.width_points,s.height_points,figure.image_width_points].every(v=>Number.isFinite(v)&&v>0)
    &&s.image_width_points>figure.image_width_points*1.12).sort((a,b)=>b.image_width_points-a.image_width_points)[0];
  // Measured source lettering is physical evidence the raster cannot give:
  // once the printed letters meet the floor, fine text alone does not require
  // a larger setting. A reported reading-size defect still takes the larger one.
  if(result.reading_detail==='small_text'&&Number.isFinite(figure.letter_points)&&figure.letter_points>=MIN_LETTER_POINTS&&['orientation_only','none'].includes(result.defect))
    return changed({confirmed:false,origin:'measured_layout',
      note:`Measured smallest printed lettering is ${figure.letter_points}pt, meeting the ${MIN_LETTER_POINTS}pt floor.`});
  if(result.reading_detail==='small_text'&&larger&&['reading_size','orientation_only','none'].includes(result.defect))
    return changed({confirmed:true,origin:'measured_layout',defect:'reading_size',required_reading_mode:larger.mode,
      note:'The image contains small text to read. Use its largest measured reading setting, then review the new PDF.'});
  if(result.defect==='orientation_only')return figure.reading_mode==='landscape'
    ?changed({confirmed:false,origin:'measured_layout',note:'The compiled figure intentionally uses landscape reading. Rotation alone is not a defect.'})
    :changed({confirmed:true,origin:'uncertain'});
  // Source crops can be intentional. Source fidelity cannot excuse an
  // unreadable print size, detached caption, or missing figure.
  if(result.defect==='crop'&&result.origin==='source_content')return changed({confirmed:false,source_preserved:true});
  // "The flagged content is in the source, and nothing is wrong in print" is
  // source preservation. Page review clears it only with an actual source
  // comparison; without one it remains held.
  if(result.defect==='none'&&result.confirmed&&result.origin==='source_content')return changed({confirmed:true,origin:'source_content',source_preserved:true});
  if(result.defect==='none')return result.confirmed?changed({confirmed:true,origin:'uncertain'}):result;
  return changed({confirmed:true,origin:'rendered_layout'});
}

// Check 8 can misclassify the intentional quarter-turn of a figure as reading
// order. Keep the typed distinction and its measured identity across both checks.
export const ReadingOrderConfirmation=FigureConfirmation.extend({
  defect:z.enum(['paragraph_split','column_order','reading_size','orientation_only','none','uncertain']),
});
export function adjudicateReadingOrderConfirmation(answer,figures){
  const result=ReadingOrderConfirmation.parse(answer);
  if(['orientation_only','reading_size'].includes(result.defect))return adjudicateFigureConfirmation(result,figures);
  if(result.origin==='uncertain'||result.defect==='uncertain'||result.defect==='none'&&result.confirmed)
    return {...result,confirmed:true,origin:'uncertain',model_confirmation:result};
  if(['paragraph_split','column_order'].includes(result.defect))return {...result,confirmed:true,origin:'rendered_layout'};
  return result;
}

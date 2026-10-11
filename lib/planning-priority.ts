export const decisionPriorities=['DEFAULT','PREFERRED_DATE','MIN_DISRUPTION','MIN_EXTERNAL'] as const;
export type DecisionPriority=typeof decisionPriorities[number];
export const decisionMetrics=['otherChangedTasks','resourceChanges','shiftDays','preferredDistanceDays','borrowedEquipmentMinutes','supportPersonMinutes'] as const;
export function priorityMetrics(priority:DecisionPriority='DEFAULT',preferred=false):typeof decisionMetrics[number][]{
 // Lexicographic priorities, NOT a conversion of machine/person time into money.
 if(priority==='MIN_EXTERNAL')return ['borrowedEquipmentMinutes','supportPersonMinutes','otherChangedTasks','preferredDistanceDays','shiftDays','resourceChanges'];
 if(priority==='MIN_DISRUPTION')return ['otherChangedTasks','shiftDays','resourceChanges','preferredDistanceDays','borrowedEquipmentMinutes','supportPersonMinutes'];
 return preferred?['preferredDistanceDays','shiftDays','otherChangedTasks','resourceChanges','borrowedEquipmentMinutes','supportPersonMinutes']:['shiftDays','otherChangedTasks','resourceChanges','preferredDistanceDays','borrowedEquipmentMinutes','supportPersonMinutes'];
}

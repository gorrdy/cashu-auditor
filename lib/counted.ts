export const PRECHECK_STAGES = ['balance', 'limits', 'reserve'];

export const COUNTED_SWAP = { OR: [{ stage: null }, { stage: { notIn: PRECHECK_STAGES } }] };

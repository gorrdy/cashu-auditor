export const PRECHECK_STAGES = ['balance', 'limits', 'reserve'];

export const COUNTED_SWAP = { kind: 'swap', OR: [{ stage: null }, { stage: { notIn: PRECHECK_STAGES } }] };

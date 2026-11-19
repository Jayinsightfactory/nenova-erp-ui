// lib/techRadarSimEngine.js
// 도입 · 기술 레이더 공용 도메인 & 실설계 파이프라인 시뮬레이션 엔진 진입점.
// /pm 경계 가드(__tests__/pmBoundary.test.js) 준수를 위해 실제 순수 구현은 lib/pmTechRadarSim.js 에 두고 여기서는 그대로 재노출한다.
export {
  RADAR_QUADRANTS,
  RADAR_RINGS,
  PIPELINE_STAGES,
  MATRIX_ZONES,
  ARCH_SURFACE_NODES,
  SIM_SCENARIOS,
  SIM_PRESETS,
  classifyQuadrant,
  inferRing,
  classifyPipelineStage,
  normalizeRadarCatalog,
  computePolarCoordinates,
  computeMatrixCoordinates,
  resolvePresetTarget,
  simulateRadarItem,
  buildWorkbenchSummary,
} from './pmTechRadarSim';

export { RADAR_PLAN_MODES, PLAN_TOKEN_PALETTES, getPlanTokenVars } from './pmRadarPlanTokens';

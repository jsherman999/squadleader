export * from './types';
export * from './data';
export * from './ctx';
export * from './rng';
export * from './queries';
export * from './engine';
export * from './phases';
export { analyzeFire, fireOdds, iftLookup, resultText, availableFire, DICE2, type FireAnalysis, type FireOdds, type UnitOdds, type TargetHex } from './rules/fire';
export { mfAllowance, mfLeft } from './rules/movement';
export { routOptions, mustRout, pendingRouts, type RoutPlan } from './rules/rout';
export { canRally, canRepair } from './rules/rally';
export { canOperateSpecial, smokeAt, isSewerEntrance, concealableHex, fanaticDrm } from './rules/special';
export { detonate } from './rules/fire';
export { ccHexes, autoPlan, oddsColumn } from './rules/closeCombat';
export { objectiveStatus, evaluateVictory, controller } from './rules/victory';
export { moraleOf } from './rules/morale';
export { exposureAt, exposureMap, type Exposure, type Threat } from './rules/exposure';
export { STAIRS_MF, floorName, floorsOn, floorsOfHex, hasUpper, isUpper, losBetween, postOf, unitSees, unitSeesAnyFloor, unitSeesHex, type Post } from './rules/floors';
export {
  FACING_NAMES,
  facingIndex,
  vehicleType,
  vehicleLabel,
  vehiclesIn,
  enemyVehiclesIn,
  wrecksIn,
  inArc,
  facingToward,
  hitAspect,
  mpLeft,
  vehicleStepCost,
  analyzeVehicleFire,
  vehicleFireOdds,
  analyzeAntiTank,
  immobilizeNumber,
  passedNear,
  hitChance,
  chance2d6,
  heEquivalent,
  killColumn,
  killNumber,
  sideVehicles,
  type Aspect,
  type VehicleFireAnalysis,
  type VehicleFireOdds,
  type VehicleFireRequest,
  type AntiTankAnalysis,
  type MpCost,
} from './rules/armor';
export { fortMoveCost, hasWire, inTrench, bunkerAt, onFire, rubbled, roadblockBetween, edgeHexes, reservesOf } from './rules/western';
export { blastArea, contactValue } from './rules/artillery';
export { illuminated, nightSight } from './rules/night';
export { riders, gunCrew } from './rules/transport';
export { designYourOwn, dyoPoints, type DyoCard, type DyoDraw, type DyoOptions, type DyoResult, type DyoRules, type DyoTerrain } from './dyo';
export { CAMPAIGN_RANKS, addCampaignLeader, campaignLeaderName, campaignLeaderType, findCampaignLeader, nextRank, scoreCampaignGame, type CampaignAward, type CampaignOutcome, type CampaignRank, type PersonnelChange } from './campaign';

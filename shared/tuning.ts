/**
 * Gameplay tuning values. These mirror the numbers in the design document
 * (README §8.2 and §14) and are the contract between the controller and
 * level design. Change them here and the debug panel/level metrics follow.
 */
export const TUNING = {
  // capsule
  radius: 0.34,
  halfHeight: 0.52,

  // ground movement (m/s, m/s²)
  walkSpeed: 2.2,
  runSpeed: 6.0,
  sprintSpeed: 8.5,
  accelGround: 40,
  decelGround: 30,
  airControl: 0.35,
  turnRate: Math.PI * 4,

  // jumping
  gravityUp: 24,
  gravityDown: 38,
  terminalVelocity: 40,
  jumpApex: 1.6,
  jumpCutMultiplier: 0.55,
  coyoteTime: 0.12,
  jumpBuffer: 0.15,

  // parkour
  vaultMin: 0.45,
  vaultMax: 1.25,
  mantleMax: 2.5,
  wallRunMinSpeed: 4.5,
  wallRunTime: 1.25,
  wallRunGravity: 6,
  wallKickSpeed: 8.5,
  wallKickUp: 7.5,
  wallClimbTime: 0.45,
  wallClimbSpeed: 5.5,
  slideTime: 0.8,
  slideFriction: 6,
  rollWindow: 0.2,
  hardLandingHeight: 12,

  // stamina
  stamina: 100,
  staminaRegen: 28,
  sprintDrain: 9,
  dodgeCost: 20,
  heavyCost: 15,

  // combat
  hitstopLight: 0.045,
  hitstopHeavy: 0.075,
  hitstopFinisher: 0.12,
  dodgeTime: 0.28,
  dodgeIFrames: 0.18,
  dodgeSpeed: 11,

  // eye powers
  dashSpeed: 18,
  dashTime: 0.35,
  superJumpMinHeight: 6,
  superJumpMaxHeight: 12.5,
  superJumpChargeTime: 0.6,
  blinkDistance: 8,

  // world
  killPlaneY: -30,
} as const;

/** Initial jump velocity for a given apex height under rising gravity. */
export function jumpVelocity(apex: number, gravity: number = TUNING.gravityUp): number {
  return Math.sqrt(2 * gravity * apex);
}

// ============================================================================
// Case 15: Tolerance Propagation in Component Chains
// ============================================================================
// Demonstrates how tolerances (tol%, min, max) declared in formulas.yaml:
//   - Propagate through formula chains
//   - Produce min/max ranges on final computed values
//   - Support ranges overrides per dependency
//   - Combine with parameterized formulas
//   - Affect arrays with tolerance
//   - Propagate through deep chains (ADC → voltage → amplified → current)
//
// The C macros define the same constants as formulas.yaml so the integration
// test can verify nominal values, while the formulas.yaml adds tolerance
// metadata (tol, min, max, ranges) that the engine propagates through the
// formula expression tree to compute output ranges.
//
// Each @test line checks the nominal value computed for a C macro.
// ============================================================================

#include <stdint.h>

// --- Scenario 1: Simple tol% on a resistor ---
// R1 = 100 ohm ±5%, SUPPLY_V = 5V
// I_R1 = 5V / 100Ω = 0.05A
#define SUPPLY_V 5
#define R1 100
#define I_R1 (SUPPLY_V / R1)
// @test TOL01 I_R1 = 0.05

// --- Scenario 2: Multiple tolerance sources combined ---
// R2 = 220Ω ±10%, R3 = 330Ω ±5%
// R_SERIES = 220 + 330 = 550Ω
#define R2 220
#define R3 330
#define R_SERIES (R2 + R3)
// @test TOL02 R_SERIES = 550

// --- Scenario 3: Explicit min/max bounds ---
// SUPPLY_V = 5V, CURRENT_SOURCE_A = 0.5A (min:0.48, max:0.52)
// POWER_SOURCE_W = 5 * 0.5 = 2.5W
#define POWER_SOURCE_W (SUPPLY_V * 0.5)
// @test TOL03 POWER_SOURCE_W = 2.5

// --- Scenario 4: ranges override ---
// V_DIVIDER_RAW = 5 * 330 / (100 + 330) = 1650/430 ≈ 3.837209302...
#define V_DIVIDER_RAW (SUPPLY_V * R3 / (R1 + R3))
// @test TOL04 V_DIVIDER_RAW = 3.8372093023255813

// --- Scenario 5: Parameterized formula with parameter tolerance ---
#define R1B 1000
#define R2B 2000
#define DIVIDER_OUT (SUPPLY_V * R2B / (R1B + R2B))
// @test TOL05 DIVIDER_OUT = 3.3333333333333335

// --- Scenario 6: Array with tol ---
#define RES_ARRAY_0 100
#define RES_ARRAY_1 220
#define RES_ARRAY_2 330
#define RES_ARRAY_3 470
#define ARRAY_SUM (RES_ARRAY_0 + RES_ARRAY_1 + RES_ARRAY_2)
// @test TOL06 ARRAY_SUM = 650

// --- Scenario 7: Mixed tol + min/max in the same chain ---
// VREF = 2.5V, DIVIDER_RATIO = 0.4 → VOUT_REF = 1.0V
#define VOUT_REF (2.5 * 0.4)
// @test TOL07 VOUT_REF = 1.0

// --- Scenario 8: Deep chain - tol propagates through intermediate derived values ---
#define RAW_ADC 2048
#define ADC_VOLTAGE (RAW_ADC * 3.3 / 4095)
// @test TOL08 RAW_ADC = 2048
// @test TOL09 ADC_VOLTAGE = 1.6504032967032967

#define AMPLIFIED_V (ADC_VOLTAGE * 10)
// @test TOL10 AMPLIFIED_V = 16.504032967032967

#define SENSED_CURRENT (AMPLIFIED_V / 0.1)
// @test TOL11 SENSED_CURRENT = 165.04032967032966

// --- Scenario 9: Zero tol (exact values, no range) ---
#define EXACT_RESULT (1.23 * SUPPLY_V)
// @test TOL12 EXACT_RESULT = 6.15

// --- Scenario 10: tol on a formula output (re-declared tolerance) ---
#define MEASURED_TEMP 25
#define COMPENSATED_OUTPUT (MEASURED_TEMP * 1.05 + 0.5)
// @test TOL13 MEASURED_TEMP = 25
// @test TOL14 COMPENSATED_OUTPUT = 26.75

// These assignments exist only so the parser has symbols to check
static const float tol01 = I_R1;
static const float tol02 = R_SERIES;
static const float tol03 = POWER_SOURCE_W;
static const float tol04 = V_DIVIDER_RAW;
static const float tol05 = DIVIDER_OUT;
static const float tol06 = ARRAY_SUM;
static const float tol07 = VOUT_REF;
static const float tol08 = RAW_ADC;
static const float tol09 = ADC_VOLTAGE;
static const float tol10 = AMPLIFIED_V;
static const float tol11 = SENSED_CURRENT;
static const float tol12 = EXACT_RESULT;
static const float tol13 = MEASURED_TEMP;
static const float tol14 = COMPENSATED_OUTPUT;
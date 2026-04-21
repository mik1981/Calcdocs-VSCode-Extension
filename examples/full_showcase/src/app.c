#include "../inc/app.h"
#include "../inc/platform.h"
#include "../inc/macro_generate.h"

// ============================================================
// 🚀 CalcDocs Showcase
// ============================================================

// 1. BASIC MACROS
#define BASE_VOLT      12
#define SCALE          2
// @test B1 BASE_VOLT * SCALE = 24
int basic = BASE_VOLT * SCALE;

// 2. CONDITIONAL COMPILATION
#define DEBUG_MODE 1
#if DEBUG_MODE == 1
  #define GAIN 10
#else
  #define GAIN 5
#endif
// @test C1 GAIN = 10
int gain_val = GAIN;

// 3. FUNCTION-LIKE MACROS
#define MUL2(x)        ((x) * 2)
#define ADD1(x)        ((x) + 1)
#define PROCESS(x)     MUL2(ADD1(x))
// @test F1 PROCESS(3) = 8
int processed = PROCESS(3);

// 4. MACRO CHAIN
#define FINAL_VAL      PROCESS(BASE_VOLT)
// @test F2 FINAL_VAL = 26
int final_val = FINAL_VAL;

// 5. YAML INTEGRATION
// @vin = 24 V
// @current = 2 A
// @test Y1 @vin * @current = 48W
float power = 0;

// 6. CSV LOOKUP
// @test CSV1 NTC_R_25 = 10000
float ntc_val = NTC_R_25;

// 7. REAL FORMULA
#define ADC_MAX      4095
#define R_PULLUP     10000  // ohm
#define NTC_ADC(r)   (ADC_MAX * (r) / (R_PULLUP + (r)))
// @test REAL1 NTC_ADC(NTC_R_25) = 2047.5
float adc_val = NTC_ADC(NTC_R_25);

// 8. IGNORE SYSTEM
// @test IGN1 BAD_EXPR = error #calcdocs-ignore-error
// int ignore_me = BAD_EXPR;

// 9. FINAL MIX
// = (@vin / R_PULLUP) -> A
#define SYSTEM_CURRENT   0.0024   //  @unit=A
// @test MIX1 SYSTEM_CURRENT = 0.0024
float sys_i = SYSTEM_CURRENT;

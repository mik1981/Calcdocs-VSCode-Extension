#include "../inc/test.h"
#include "../macro_generate.h"

#ifndef __TEST_H
  #error "manca include di test.h
#endif

#if !defined(__TEST_H)

#else

#define MULTIPLE_CONDITION_TEST   (4*ADC_RES)

#if DEBUG_MODE == 1
  #define K_HEX_ENABLE 1
#else
  #define K_HEX_ENABLE 0
#endif

#define MAX_VEL   (VEL*100)


// ==== Valori base ====
#define MUL     (2<<1)        //  V
#define USE_VEL VEL
#define NEG     -5

#if K_HEX_ENABLE
  #define K_1       0x10  // 16 dec
#else
  #define K_1       6  // 6 dec
#endif

#if DEBUG_MODE == 0
  #define K_2       6  // 6 dec
#else
  #define K_2       0x10  // 16 dec
#endif

// ==== Macro object-like e derivate ====
// #define /*@M1@*/FINAL   (VEL * MUL)
#define FINAL   (/*@M2@*/VEL * MUL)
#define LAST    (FINAL*(2+0.01))

// ==== Function-like ====
#define A(x)    ((x) * 2)
#define B(y)    A((y) + 1)
#define C       B(2) + 1

#define PT100_OHM_MIN   ( 58.93 )//ohm
#define PT100_OHM_MAX   ( 217.16 )
#define PT100_TOT_AMPL  ( 0.000974 * 32.44192581 / 5.0 )
#define PT100_NUM16(R)  (signed int)(0.5 + ( R - PT100_OHM_MIN ) * PT100_TOT_AMPL * 65536.0 )
// hover su RHS function-like
#define PT100_100OHM    PT100_NUM16(100)
#define ADC_STD         NTC_ADC(6)

// ==== Commenti, cast, line continuation, operatori ====
#define CAST_EX     (int)(VEL * 1.53)
#define COMMENTED   (VEL /*speed*/ + MUL /*mult*/)
#define CONT_SUM(a,b) ((a) + \
                       (b))
#define NEGUSE      (NEG * 2)

// === Codelens superflui ===
uint8_t Flags; // Flags applicazione
#define REQ_USERPARS_SAVE_SET()   (Flags |= 0x01)   /* Richiesta salvataggio parametri utente*/
#define OPTBYTE_WRP     (~(0U))    /* protect none page */
#define REQ_USERPARS_MULTI      (((uint32_t)OPTBYTE_WRP & 0x01) |\
                                   ((uint32_t)0xAF & 0x02)\
                                )

// @vin = 13V
// @r = 4.7kOhm
// @tensione = @config.vin + 1
#define RESULT_COMPUTE_MA 2.5    // = @config.c.vin / @r -> mA 
#define RESULT_NO         2.8    // @vin * @r -> mA

// = 25% * 200W -> W
// = 0.015s -> ms
// = 100 bar + 100 kPa -> atm

// = A + B #calcdocs-ignore-line
// = BAD_EXPR #calcdocs-ignore-error
// calcdocs-ignore-line; = @x + 1
#define REG_E_MOT_INH_POL     0          //  =0 inibisce il canale a 0V, =1 inibisce il canale a Vmot
#define r(y,z)          (((y & z)/* == 0*/)? (0x01) : (0x00))

#define EvtCnt_IncSat(n)     do {} while(0);


// Example constants
void test_init(void) {
  if (Flags < VBATT_TO_ADC(NOBAT_VOLT_TH)) {
  }
}

#define RPM 1000
#define SPEED (RPM * 0.10472)   // sparisci



// ==== Stringizing e token pasting (opzionali) ====
#define STR(x)  #x
#define CAT(a,b) a##b

// ==== Uso in codice ====
int main() {
  int z1 = /*@M5@*/PT100_NUM16(3);
  int z2 = /*@M6@*/FINAL;              // 80
  int z3 = /*@M7@*/LAST;               // 160.8
  int z4 = /*@M8@*/B(4);
  int z5_1 = /*@M9@*/K_1;
  int z5_2 = /*@M9@*/K_2;
  int z6 = /*@M10@*/NEGUSE;            // -10
  int z7 = /*@M11@*/CONT_SUM(3,4);
  int z8 = /*@M12@*/CAST_EX;           // (int)(10*1.53)=(int)(30.6)
  int z9 = /*@M13@*/COMMENTED;         // 24
  const char* s = /*@M14@*/STR(HELLO);
  int xy = /*@M15@*/CAT(1,2);
  int adc_st = NTC_ADC(6);

  return 0;
}

#endif
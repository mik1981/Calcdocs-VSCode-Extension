// ==== Valori base ====
#define MUL     (2<<1)
#define VEL     20
#define NEG     -5
#define K       0x10  // 16 dec

// ==== Macro object-like e derivate ====
// #define /*@M1@*/FINAL   (VEL * MUL)
#define FINAL   (/*@M2@*/VEL * MUL)
#define LAST    (FINAL*(2+0.01))

// ==== Function-like ====
#define A(x)    ((x) * 2)
#define B(y)    A((y) + 1)

#define PT100_OHM_MIN   ( 58.93 )//ohm
#define PT100_OHM_MAX   ( 217.16 )//ohm
#define PT100_TOT_AMPL  ( 0.000974 * 32.44192581 / 5.0 )
#define PT100_NUM16(R)  (unsigned int)(0.5 + ( R - PT100_OHM_MIN ) * PT100_TOT_AMPL * 65536.0 )
#define PT100_100OHM    PT100_NUM16(100)        // hover su RHS function-like

// ==== Commenti, cast, line continuation, operatori ====
#define CAST_EX     (int)(VEL * 1.53)
#define COMMENTED   (VEL /*speed*/ + MUL /*mult*/)
#define CONT_SUM(a,b) ((a) + \
                       (b))
#define NEGUSE      (NEG * 2)

// ==== Stringizing e token pasting (opzionali) ====
#define STR(x)  #x
#define CAT(a,b) a##b

// ==== Uso in codice ====
int main() {
  int z1 = /*@M5@*/PT100_NUM16(3);     // -23163
  int z2 = /*@M6@*/FINAL;              // 80
  int z3 = /*@M7@*/LAST;               // 160.8
  int z4 = /*@M8@*/B(4);               // A(5)=10
  int z5 = /*@M9@*/K;                  // 16
  int z6 = /*@M10@*/NEGUSE;            // -10
  int z7 = /*@M11@*/CONT_SUM(3,4);     // 7
  int z8 = /*@M12@*/CAST_EX;           // (int)(10*1.53)=(int)(30.6)
  int z9 = /*@M13@*/COMMENTED;         // 24
  const char* s = /*@M14@*/STR(HELLO); // opzionale: "HELLO" o preview stringa
  int xy = /*@M15@*/CAT(1,2);          // opzionale: 12 post-preprocessore

  // Hover su RHS in #define: vogliamo la call, NON il simbolo LHS
  // Riga di definizione: #define PT100_100OHM PT100_NUM16(100)
  // Cursor su PT100_NUM16 nella RHS (altra riga per sicurezza)
  #define RHS_TEST   PT100_NUM16(/*@M16@*/5)

  return 0;
}

#define MUL         (2<<1)
#define VEL         20

#define FINAL       (VEL * MUL)

#define LAST        (FINAL*(2+0.01))

#define NTC_ADC     

#define PT100_OHM_MIN   ( 58.93 )//ohm
#define PT100_OHM_MAX   ( 217.16 )//ohm
#define PT100_TOT_AMPL  ( 0.000974 * 32.44192581 / 5.0 )

// Valore adc rispetto a resistenza interessata
#define PT100_NUM16(R)          (unsigned int)(0.5 + ( R - PT100_OHM_MIN ) * PT100_TOT_AMPL * 65536.0 )
#define PT100_100OHM            PT100_NUM16(100)

unsigned int v_vel = VEL * 3;
unsigned int pt100 = PT100_NUM16(100);

const unsigned int TABLE[] = 
{
    PT100_NUM16(0),
    PT100_NUM16(100),
    PT100_NUM16(200)
};

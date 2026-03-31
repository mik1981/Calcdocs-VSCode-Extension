/**
  ******************************************************************************
  * File Name          : ADC.h
  * Description        : This file provides code for the configuration
  *                      of the ADC instances.
  ******************************************************************************
  * This notice applies to any and all portions of this file
  * that are not between comment pairs USER CODE BEGIN and
  * USER CODE END. Other portions of this file, whether 
  * inserted by the user or by software development tools
  * are owned by their respective copyright owners.
  *
  * Copyright (c) 2018 STMicroelectronics International N.V. 
  * All rights reserved.
  *
  * Redistribution and use in source and binary forms, with or without 
  * modification, are permitted, provided that the following conditions are met:
  *
  * 1. Redistribution of source code must retain the above copyright notice, 
  *    this list of conditions and the following disclaimer.
  * 2. Redistributions in binary form must reproduce the above copyright notice,
  *    this list of conditions and the following disclaimer in the documentation
  *    and/or other materials provided with the distribution.
  * 3. Neither the name of STMicroelectronics nor the names of other 
  *    contributors to this software may be used to endorse or promote products 
  *    derived from this software without specific written permission.
  * 4. This software, including modifications and/or derivative works of this 
  *    software, must execute solely and exclusively on microcontroller or
  *    microprocessor devices manufactured by or for STMicroelectronics.
  * 5. Redistribution and use of this software other than as permitted under 
  *    this license is void and will automatically terminate your rights under 
  *    this license. 
  *
  * THIS SOFTWARE IS PROVIDED BY STMICROELECTRONICS AND CONTRIBUTORS "AS IS" 
  * AND ANY EXPRESS, IMPLIED OR STATUTORY WARRANTIES, INCLUDING, BUT NOT 
  * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A 
  * PARTICULAR PURPOSE AND NON-INFRINGEMENT OF THIRD PARTY INTELLECTUAL PROPERTY
  * RIGHTS ARE DISCLAIMED TO THE FULLEST EXTENT PERMITTED BY LAW. IN NO EVENT 
  * SHALL STMICROELECTRONICS OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
  * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
  * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, 
  * OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF 
  * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING 
  * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
  * EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  *
  ******************************************************************************
  */
/* Define to prevent recursive inclusion -------------------------------------*/
#ifndef __adc_H
#define __adc_H
#ifdef __cplusplus
 extern "C" {
#endif

/* Includes ------------------------------------------------------------------*/
#include "stm32f0xx_hal.h"
#include "main.h"

/* USER CODE BEGIN Includes */

/* USER CODE END Includes */

extern ADC_HandleTypeDef hadc;

/* USER CODE BEGIN Private defines */

#define ADC_RES     1024
#define ADC_VREF    (3.3)

// Current constants
/* HW revisions 00 ... 03 */
#define RSHUNT_HW00       (0.001)                 // shunt resistor value: 2x2mOhm parallel
#define AMP_GAIN_HW00     (20.0)                  // amplifier gain
#define AMP_GAIN_ADJ_HW00 (1.00)	          // current gain adjust (actual would be 1.08)
#define AMP_OFFS_HW00     (0.5*10.0/(10.0+5.6))   // amplifier offset (ratio)
// base current: max readable current
#define AMP_BASE_HW00     ((uint16_t)((1.0 * CURRENT_KMUL * ADC_VREF) / (1.0 * AMP_GAIN_HW00 * RSHUNT_HW00)))

/* HW revisions 04 ... */
#define RSHUNT_HW04       (0.000667)              // shunt resistor value: 3x2mOhm parallel
#define AMP_GAIN_HW04     (20.0)                  // amplifier gain
#define AMP_GAIN_ADJ_HW04 (0.85)	          // current gain adjust (7% under estimate, 8% compensate over estimate of hw00)
#define AMP_OFFS_HW04     (0.5*10.0/(10.0+5.6))   // amplifier offset (ratio)
// base current: max readable current
#define AMP_BASE_HW04     ((uint16_t)((1.0 * CURRENT_KMUL * ADC_VREF) / (1.0 * AMP_GAIN_HW04 * AMP_GAIN_ADJ_HW04 * RSHUNT_HW04)))


// Voltage constants
#define VBATT_RATIO       (3.3 / (3.3 + 47.0))    // Vadc / Vbatt ratio
#define ADC_TO_VBATT(adc) (((uint32_t)(adc) * (uint32_t)(10.0 * VOLTAGE_KMUL * ADC_VREF)) / (uint32_t)(10.0 * ADC_RES * VBATT_RATIO))
#define VBATT_TO_ADC(v)   ((uint16_t) ((1.0 * ADC_RES * VBATT_RATIO * (v)) / (VOLTAGE_KMUL * ADC_VREF)))
#define VBATT_LEVEL_HYST  ((uint16_t)(0.1 * VOLTAGE_KMUL))
#define NOBAT_VOLT_TH     (5.0 * VOLTAGE_KMUL)       /* no battery voltage threshold */



// polynomial approx of T = f(alpha)  (alpha = ADC/ADC_RES)
//
//                             K1          K2
//    T = T0 + K * alpha + ---------- + ----------
//                         (alpha-A1)   (A2-alpha)
//
//
//          1   (            K*KPREC        K1*ADC_RES*KPREC     K2*ADC_RES*KPREC  )
//    T = ----- ( T0*KPREC + ------- ADC + ------------------ + ------------------ )
//        KPREC (            ADC_RES       (ADC - A1*ADC_RES)   (A2*ADC_RES - ADC) )


// Battery temperature constant
#define BATT_NTC_75     1000    //  minimum value from battery datasheet
#define BATT_NTC_80     887     //  nominal value from battery datasheet
#define BATT_NTC_85     750     //  maximum value from battery datasheet
#define BATT_NTC_UVP    400     //  200 nominal + Vce sat

#if (HW_REVISION == 0)
#define BATT_NTC_RPOL   1000    //  polarization resistor

// linear approximation of adc to temp
#define ADC_TO_TEMP_T0_1    142
#define ADC_TO_TEMP_K_1     132
#define ADC_TO_TEMP_T0_2    285
#define ADC_TO_TEMP_K_2     300
#define ADC_TO_TEMP_KNEE    (uint16_t)(0.85*ADC_RES)

#define NTBATT_ADC2TEMP(adc) ((adc) < ADC_TO_TEMP_KNEE ? \
                             (int16_t)ADC_TO_TEMP_T0_1 - (int16_t)(((int32_t)(adc) * ADC_TO_TEMP_K_1) / ADC_RES) : \
                             (int16_t)ADC_TO_TEMP_T0_2 - (int16_t)(((int32_t)(adc) * ADC_TO_TEMP_K_2) / ADC_RES) )

#define NTBATT_ADC_OPEN      (ADC_RES - 5)
#define NTBATT_ADC_UVP       (uint16_t)((uint32_t)BATT_NTC_UVP * ADC_RES / (BATT_NTC_UVP + BATT_NTC_RPOL))
#define NTBATT_ADC_SHORT     ((uint16_t)(0.13 * ADC_RES))  // <150 Ohm

#elif (HW_REVISION == 1)
#define NTBATT_RPOL   1000    //  polarization resistor
#define NTBATT_RPAR   56000   //  parallel resistor

#define NTBATT_T0      117.0
#define NTBATT_K       -100.0
#define NTBATT_K1      6.1
#define NTBATT_A1      0.0
#define NTBATT_K2      -1.9
#define NTBATT_A2      1.01
#define NTBATT_KPREC   16

#define NTBATT_T0_INT    (int32_t)(NTBATT_T0 * NTBATT_KPREC)   // 1872d  0x750
#define NTBATT_K_INT_N   (int32_t)(NTBATT_K  * NTBATT_KPREC)   // -1600d 0xFFFFF9C0
#define NTBATT_K1_INT    (int32_t)(NTBATT_K1 * NTBATT_KPREC * ADC_RES)  // 93388d 0x16CCC
#define NTBATT_K2_INT    (int32_t)(NTBATT_K2 * NTBATT_KPREC * ADC_RES)  // -31130d 0xffff8666
#define NTBATT_A1_INT    (int32_t)(NTBATT_A1 * ADC_RES)                 // 0
#define NTBATT_A2_INT    (int32_t)(NTBATT_A2 * ADC_RES)                 // 1034d 0x40A

#define NTBATT_ADC2TEMP(adc) (int16_t)( ( NTBATT_T0_INT +\
                                          ((NTBATT_K_INT_N * (adc)) / ADC_RES) +\
                                          (NTBATT_K1_INT / ((adc) - NTBATT_A1_INT)) +\
                                          (NTBATT_K2_INT / (NTBATT_A2_INT - (adc)))\
                                        )  / NTBATT_KPREC)

#define NTBATT_RATIO(R)    (1.0 / (1.0 + (1.0 * (NTBATT_RPOL) * (1.0 * (R) + (NTBATT_RPAR))) / (1.0 * (R) * (NTBATT_RPAR))))

//#define NTBATT_ADC_OPEN      ((uint16_t)(0.973 * ADC_RES))  // < -26°C
//#define NTBATT_ADC_UVP       ((uint16_t)(0.23 * ADC_RES))   // < 300 Ohm, > 115°C°C
//#define NTBATT_ADC_SHORT     ((uint16_t)(0.10 * ADC_RES))   // <150 Ohm
#define NTBATT_ADC_OPEN      ((uint16_t)(NTBATT_RATIO(BATTERY_DEF_NTCMAX) * ADC_RES))
#define NTBATT_ADC_UVP       ((uint16_t)(NTBATT_RATIO(BATTERY_DEF_NTCUVP) * ADC_RES))
#define NTBATT_ADC_SHORT     ((uint16_t)(NTBATT_RATIO(BATTERY_DEF_NTCMIN) * ADC_RES))


#else
#error "HW_REVISION not valid"
#endif



// Mosfet temperature constant
#if (HW_REVISION == 0)
#define MOS_NTC_RPOL   2200    // polarization resistor
#define MOS_NTC_RPAR   33000   // parallel resisor

#define NTMOS_ADC_OPEN      ((uint16_t)(0.92 * ADC_RES)) // < -25°C
#define NTMOS_ADC_SHORT     ((uint16_t)(0.08 * ADC_RES)) // >150 °C

#define ADC_TO_MOSTEMP_T0   145
#define ADC_TO_MOSTEMP_K0   168
#define NTMOS_ADC2TEMP(adc)   (int16_t)ADC_TO_MOSTEMP_T0 - (int16_t)(((int32_t)(adc) * ADC_TO_MOSTEMP_K0) / ADC_RES)

#elif (HW_REVISION == 1)
#define NTMOS_RPOL   2200    // polarization resistor
#define NTMOS_RPAR   33000   // parallel resistor

#define NTMOS_T0      84.0
#define NTMOS_K       -91.0
#define NTMOS_K1      4.0
#define NTMOS_A1      0.0
#define NTMOS_K2      -1.7
#define NTMOS_A2      0.96
#define NTMOS_KPREC   16

#define NTMOS_T0_INT    (int32_t)(NTMOS_T0 * NTMOS_KPREC)
#define NTMOS_K_INT_N   (int32_t)(NTMOS_K * NTMOS_KPREC)
#define NTMOS_K1_INT    (int32_t)(NTMOS_K1 * NTMOS_KPREC * ADC_RES)
#define NTMOS_K2_INT    (int32_t)(NTMOS_K2 * NTMOS_KPREC * ADC_RES)
#define NTMOS_A1_INT    (int32_t)(NTMOS_A1 * ADC_RES)
#define NTMOS_A2_INT    (int32_t)(NTMOS_A2 * ADC_RES)

#define NTMOS_ADC2TEMP(adc) (int16_t)( ( NTMOS_T0_INT +\
                                       ((NTMOS_K_INT_N * (adc)) / ADC_RES) +\
                                       (NTMOS_K1_INT / ((adc) - NTMOS_A1_INT)) +\
                                       (NTMOS_K2_INT / (NTMOS_A2_INT - (adc)))\
                                     )  / NTMOS_KPREC)

#define NTMOS_ADC_OPEN      ((uint16_t)(0.925 * ADC_RES)) // < -40°C
#define NTMOS_ADC_SHORT     ((uint16_t)(0.07 * ADC_RES))  // > 125°C


#else
#error "HW_REVISION not valid"
#endif

// ADC channels
typedef enum
{
  ADCH_VBAT = 0,
  ADCH_CURR,
  ADCH_BATNTC,
  ADCH_TEMP,
  ADCH_PRESS,
  ADCH_NUM
} ADCChannel_t;

// DMA raw adc readings
extern uint16_t ADCReading[ADCH_NUM];      // ADC raw readings

// Battery voltage filter
extern uint32_t VBatAcc_u32;
#define GET_VBAT_ADC() (uint16_t)(VBatAcc_u32 / 65536)

// Battery ntc filter
extern uint32_t BatNtcAcc_u32;
#define GET_BATNTC_ADC() (uint16_t)(BatNtcAcc_u32 / 65536)

// Battery ntc filter
extern uint32_t MosNtcAcc_u32;
#define GET_MOSNTC_ADC() (uint16_t)(MosNtcAcc_u32 / 65536)

// exported adc startup reading
extern uint16_t  CalReading;
extern uint16_t  TempReading;
extern uint16_t  VrefReading;

/* USER CODE END Private defines */

extern void _Error_Handler(char *, int);

void MX_ADC_Init(void);

/* USER CODE BEGIN Prototypes */
/* basic ADC init */
extern void Basic_ADC_Init(void);

/* basic ADC stop */
extern void Basic_ADC_Stop(void);

/* basic ADC reset */
extern void Basic_ADC_Reset(void);

/* read channel */
extern uint16_t ADC_ReadChannel(uint32_t ch);

/* read internal temp sensor */
extern uint16_t ADC_ReadTemp(void);

/* read internal Vref */
extern uint16_t ADC_ReadVref(void);


/* USER CODE END Prototypes */

#ifdef __cplusplus
}
#endif
#endif /*__ adc_H */

/**
  * @}
  */

/**
  * @}
  */

/************************ (C) COPYRIGHT STMicroelectronics *****END OF FILE****/

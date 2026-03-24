#ifndef __TEST_H
#define __TEST_H
#ifdef __cplusplus
 extern "C" {
#endif

#include "main.h"

typedef unsigned char uint8_t;
typedef unsigned int uint16_t;

#define DEBUG_MODE        0  //Usato per debug


#define ADC_RES     1024
#define ADC_VREF    (3.3)
#define VBATT_RATIO       (3.3 / (3.3 + 47.0))    // Vadc / Vbatt ratio
#define NOBAT_VOLT_TH     (5.0 * VOLTAGE_KMUL)       /* no battery voltage threshold */
#define VBATT_TO_ADC(v)   ((uint16_t) ((1.0 * ADC_RES * VBATT_RATIO * (v)) / (VOLTAGE_KMUL * ADC_VREF)))

#ifdef __cplusplus
 }
#endif

#endif
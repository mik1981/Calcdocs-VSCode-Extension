#ifndef __MAIN_H
#define __MAIN_H

#if (ENABLE_DEBUG_PRINTF_GLOBAL == 1)
#include "SEGGER_RTT.h"		// debug terminal
//#define Debug_printf(...)	(void)SEGGER_RTT_printf(0, __VA_ARGS__)
#define Debug_printf(...)	do{uint32_t ticks_=HAL_GetTick();SEGGER_RTT_printf(0,"%ld.%03ld;",  ticks_ / 1000,  ticks_ % 1000 );SEGGER_RTT_printf(0,"[%s][%d]",__FUNCTION__,__LINE__);SEGGER_RTT_printf(0, __VA_ARGS__); SEGGER_RTT_printf(0,"\n\r"); }while(0)

#else
#define Debug_printf(...) (void)(0U)

#endif


#define VOLTAGE_KMUL    100 // lsb/V

#endif
#include "config.h"
#if DEBUG_MODE == 1
  #define GAIN 10
#else
  #define GAIN 5
#endif
// @test C1 GAIN = 10
int g = GAIN;

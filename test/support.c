#include "test.h"

#ifndef __TEST_H
  #error "manca include di test.h
#endif


#if DEBUG_MODE == 1
  #define K_HEX_ENABLE_2 1
#else
  #define K_HEX_ENABLE_2 0
#endif

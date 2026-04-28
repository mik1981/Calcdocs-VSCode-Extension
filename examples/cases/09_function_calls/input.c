#include <stdint.h>

#define COMMENTED 28
#define COMMENTED_B 4

void HAL_delay(int);
void HAL_delayB(int,int);

void delay_example(void)
{
  // Line ~106 equivalent: standalone function call stmt
  HAL_delay(COMMENTED);

  // Line ~106 equivalent: standalone function call stmt
  HAL_delayB(COMMENTED, COMMENTED_B);
  
  // Also with trailing comment
  HAL_delay(COMMENTED); /* test */
  
  // With ws
  HAL_delay (COMMENTED ) ;
}

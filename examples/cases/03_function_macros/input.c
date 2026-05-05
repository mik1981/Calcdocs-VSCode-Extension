#define A3(x) ((x)*2)
#define B3(y) A3((y)+1)
// @test F1 A3(3) = 6
int t0301 = A3(3);
// @test F2 B3(4) = 10
int t0302 = B3(4);

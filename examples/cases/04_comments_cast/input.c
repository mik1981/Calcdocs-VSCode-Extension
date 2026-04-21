#define A4 10
#define B4 (A4 /*comment*/ + 2)
#define C (int)(A4 * 1.5)
// @test E1 B4 = 12
int t41 = B4;
// @test E2 C = 15
int t42 = C;

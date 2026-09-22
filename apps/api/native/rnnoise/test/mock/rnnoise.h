#ifndef COURSEFORGE_RNNOISE_TEST_MOCK_H
#define COURSEFORGE_RNNOISE_TEST_MOCK_H
#include <stdio.h>

typedef struct DenoiseState DenoiseState;
typedef struct RNNModel RNNModel;

int rnnoise_get_frame_size(void);
RNNModel *rnnoise_model_from_file(FILE *file);
DenoiseState *rnnoise_create(RNNModel *model);
float rnnoise_process_frame(DenoiseState *state, float *output, const float *input);
void rnnoise_destroy(DenoiseState *state);
void rnnoise_model_free(RNNModel *model);

#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "rnnoise.h"

struct RNNModel { int marker; };
struct DenoiseState { float previous[480]; };

int rnnoise_get_frame_size(void) { return 480; }

RNNModel *rnnoise_model_from_file(FILE *file) {
  RNNModel *model;
  if (file == NULL) return NULL;
  model = malloc(sizeof(*model));
  if (model != NULL) model->marker = 1;
  return model;
}

DenoiseState *rnnoise_create(RNNModel *model) {
  if (model == NULL) return NULL;
  return calloc(1, sizeof(DenoiseState));
}

float rnnoise_process_frame(DenoiseState *state, float *output, const float *input) {
  memcpy(output, state->previous, sizeof(state->previous));
  memcpy(state->previous, input, sizeof(state->previous));
  return 0.0f;
}

void rnnoise_destroy(DenoiseState *state) { free(state); }
void rnnoise_model_free(RNNModel *model) { free(model); }

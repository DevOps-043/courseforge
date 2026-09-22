/* Courseforge RNNoise PCM adapter. This file does not contain model weights. */
#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <rnnoise.h>

enum { FRAME_SAMPLES = 480, FRAME_BYTES = FRAME_SAMPLES * 2 };
#define MAX_INPUT_BYTES (50u * 1024u * 1024u)

enum ExitCode {
  EXIT_USAGE = 2,
  EXIT_INPUT = 3,
  EXIT_MODEL = 4,
  EXIT_IO = 5,
  EXIT_ENGINE = 6
};

static int16_t decode_sample(const unsigned char *bytes) {
  return (int16_t)((uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8));
}

static void encode_sample(unsigned char *bytes, int16_t sample) {
  uint16_t value = (uint16_t)sample;
  bytes[0] = (unsigned char)(value & 0xffu);
  bytes[1] = (unsigned char)(value >> 8);
}

static int write_samples(FILE *output, const float *samples, size_t count) {
  unsigned char bytes[FRAME_BYTES];
  size_t index;

  for (index = 0; index < count; ++index) {
    long rounded;
    if (!isfinite(samples[index])) return EXIT_ENGINE;
    if (samples[index] >= 32767.0f) rounded = 32767;
    else if (samples[index] <= -32768.0f) rounded = -32768;
    else rounded = lroundf(samples[index]);
    encode_sample(&bytes[index * 2], (int16_t)rounded);
  }
  return fwrite(bytes, 1, count * 2, output) == count * 2 ? 0 : EXIT_IO;
}

static int process_pcm(FILE *input, FILE *output, DenoiseState *state) {
  unsigned char bytes[FRAME_BYTES];
  float input_frame[FRAME_SAMPLES];
  float output_frame[FRAME_SAMPLES];
  size_t previous_sample_count = 0;
  size_t total_bytes = 0;

  for (;;) {
    size_t byte_count = fread(bytes, 1, sizeof(bytes), input);
    size_t sample_count;
    size_t index;
    int write_result;

    if (ferror(input)) return EXIT_IO;
    if (byte_count == 0) {
      if (!feof(input)) return EXIT_IO;
      break;
    }
    if (total_bytes > MAX_INPUT_BYTES - byte_count || (byte_count & 1u)) return EXIT_INPUT;
    if (byte_count < sizeof(bytes) && !feof(input)) return EXIT_IO;
    total_bytes += byte_count;
    sample_count = byte_count / 2;

    for (index = 0; index < sample_count; ++index) {
      input_frame[index] = (float)decode_sample(&bytes[index * 2]);
    }
    for (; index < FRAME_SAMPLES; ++index) input_frame[index] = 0.0f;

    rnnoise_process_frame(state, output_frame, input_frame);
    /* RNNoise emits the preceding frame. Drop its initial unprimed output. */
    if (previous_sample_count > 0) {
      write_result = write_samples(output, output_frame, previous_sample_count);
      if (write_result != 0) return write_result;
    }
    previous_sample_count = sample_count;
  }

  if (total_bytes == 0) return EXIT_INPUT;
  memset(input_frame, 0, sizeof(input_frame));
  rnnoise_process_frame(state, output_frame, input_frame);
  return write_samples(output, output_frame, previous_sample_count);
}

int main(int argc, char **argv) {
  FILE *input = NULL;
  FILE *output = NULL;
  FILE *model_file = NULL;
  RNNModel *model = NULL;
  DenoiseState *state = NULL;
  char *temporary_path = NULL;
  size_t temporary_path_length;
  int descriptor = -1;
  int result = EXIT_IO;

  if (argc != 4 || strcmp(argv[2], argv[3]) == 0) {
    fputs("usage: rnnoise-pcm MODEL INPUT.pcm OUTPUT.pcm\n", stderr);
    return EXIT_USAGE;
  }
  if (rnnoise_get_frame_size() != FRAME_SAMPLES) {
    fputs("RNNOISE_FRAME_SIZE_UNSUPPORTED\n", stderr);
    return EXIT_ENGINE;
  }

  model_file = fopen(argv[1], "rb");
  if (model_file == NULL) {
    fputs("RNNOISE_MODEL_UNAVAILABLE\n", stderr);
    return EXIT_MODEL;
  }
  model = rnnoise_model_from_file(model_file);
  if (model == NULL) {
    fputs("RNNOISE_MODEL_UNAVAILABLE\n", stderr);
    fclose(model_file);
    return EXIT_MODEL;
  }
  state = rnnoise_create(model);
  if (state == NULL) {
    fputs("RNNOISE_STATE_UNAVAILABLE\n", stderr);
    result = EXIT_ENGINE;
    goto cleanup;
  }
  input = fopen(argv[2], "rb");
  if (input == NULL) {
    fputs("RNNOISE_INPUT_UNAVAILABLE\n", stderr);
    result = EXIT_INPUT;
    goto cleanup;
  }

  if (strlen(argv[3]) > SIZE_MAX - sizeof(".XXXXXX")) {
    result = EXIT_USAGE;
    goto cleanup;
  }
  temporary_path_length = strlen(argv[3]) + sizeof(".XXXXXX");
  temporary_path = malloc(temporary_path_length);
  if (temporary_path == NULL) goto cleanup;
  snprintf(temporary_path, temporary_path_length, "%s.XXXXXX", argv[3]);
  descriptor = mkstemp(temporary_path);
  if (descriptor < 0) goto cleanup;
  output = fdopen(descriptor, "wb");
  if (output == NULL) goto cleanup;
  descriptor = -1;

  result = process_pcm(input, output, state);
  if (result == 0 && fflush(output) != 0) result = EXIT_IO;
  if (fclose(output) != 0) result = EXIT_IO;
  output = NULL;
  if (fclose(input) != 0) result = EXIT_IO;
  input = NULL;
  if (result == 0 && rename(temporary_path, argv[3]) != 0) result = EXIT_IO;

cleanup:
  if (output != NULL) fclose(output);
  if (descriptor >= 0) close(descriptor);
  if (input != NULL) fclose(input);
  if (temporary_path != NULL) {
    if (result != 0) unlink(temporary_path);
    free(temporary_path);
  }
  if (state != NULL) rnnoise_destroy(state);
  rnnoise_model_free(model);
  if (model_file != NULL) fclose(model_file);
  if (result != 0) fprintf(stderr, "RNNOISE_ADAPTER_FAILED:%d\n", result);
  return result;
}

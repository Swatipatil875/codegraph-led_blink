# CodeGraph LED Blink

A polished STM32 LED-blinking firmware project paired with a CodeGraph-powered assistant workflow for exploring the codebase.

## Overview

This repository brings together:

- an STM32 firmware example that blinks LEDs in a binary-counting pattern
- a CodeGraph-based local knowledge graph for asking code questions about the project
- a simple, developer-friendly structure for learning embedded C and code navigation

## Project Structure

- [STM-LED](STM-LED) — the firmware project for the STM32 Discovery board
- [codegraph](codegraph) — the CodeGraph toolchain used to index and query the codebase

## What the firmware does

The STM32 application initializes the MCU, configures the GPIO pins, and drives the LEDs in a repeating binary-count sequence across the GPIOC pins.

## Quick Start

1. Open the STM-LED folder in STM32CubeIDE or your preferred STM32 development environment.
2. Build and flash the firmware to your STM32 board.
3. Use the CodeGraph assistant to explore the codebase and trace execution flow.

## CodeGraph Assistant

You can ask questions such as:

- trace execution flow from main to ledControl
- where should I change the blink delay
- how does main initialize GPIO
- who calls ledControl

## Features

- Embedded C firmware example
- Clear GPIO and LED control flow
- CodeGraph indexing for semantic code exploration
- Easy to extend for more STM32 experiments

## Getting Started

```powershell
cd STM-LED
# Open the project in STM32CubeIDE and flash it to the board
```

## License

This project is intended for learning and experimentation.

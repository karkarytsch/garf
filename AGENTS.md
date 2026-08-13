# AGENTS.md

## Garf

Garf is a platform for econometric, statistical, and ML analysis.

The primary goal is to build a **fast, highly interactive, intuitive, robust, and visually clear analytical environment** where users can work with datasets, perform econometric and statistical analysis, run tests, inspect results, and understand data through useful visualizations.

Time-series analysis is one of the important focus areas.

## Project priorities

The core analytical functionality comes first:

- dataset import and handling;
- data inspection and manipulation;
- econometric analysis;
- statistical tests;
- time-series analysis;
- ML functionality;
- interactive visualizations;
- performance and memory efficiency;
- correctness and robustness.

Garf should be designed to work efficiently with large datasets and computationally expensive operations.

## Long-term educational goal

Garf is also intended to integrate into the university environment.

This may include:

- student and teacher environments;
- university integration;
- assignments and tests;
- guides and learning materials;
- teacher-student interaction.

This is a **long-term goal built on top of the analytical platform**.

Do not prioritize university/LMS functionality over completing and improving the core analytical functionality unless explicitly requested.

## Architecture

Read `ARCHITECTURE.md` before making architectural or structural changes.

`ARCHITECTURE.md` is the source of truth for the project's implementation, structure, components, dependencies, and important technical decisions.

Do not assume architecture based on this file.

After making a change that affects the architecture, project structure, important data flows, dependencies, or responsibilities of components, **update `ARCHITECTURE.md` accordingly**.

Keep it synchronized with the actual implementation. Do not document planned architecture there as if it already exists.

## Code style

Keep code:

- clean;
- minimal;
- readable;
- easy to understand for beginner and mid-level developers;
- as simple as reasonably possible.

Avoid unnecessary abstractions, overengineering, and clever code.

Prefer straightforward logic over complicated architecture.

Use concise comments frequently where they help explain important logic. Comments should normally be short and lowercase, for example:

```python
# keep row order stable after filtering
```

Do not add comments that only repeat what the code already clearly says.

## Performance

Performance and memory usage are important parts of Garf.

When working with datasets or statistical computation, actively consider:

- unnecessary data copies;
- repeated dataset reads;
- repeated calculations;
- unnecessary serialization or data transfer;
- unnecessary API calls;
- excessive frontend rendering;
- memory usage;
- algorithmic efficiency.

Prefer simple, efficient solutions.

Do not introduce complex optimization infrastructure without a real need.

When a clearly more efficient solution exists, recommend it.

## Design and interactivity

Garf should have a **highly interactive, responsive, and visually clear analytical interface**.

We are not building a conventional website or a static dashboard. Garf should feel like a purpose-built analytical environment where users directly interact with their data, models, results, and visualizations.

Interactions should feel immediate and connected. Where appropriate, changing variables, filters, transformations, model parameters, selections, or observations should update the relevant analysis and visualizations naturally.

Prioritize:

- fast and responsive interactions;
- direct manipulation of data and analytical controls;
- interactive and informative visualizations;
- clear relationships between data, analysis, and results;
- minimal friction between analytical actions;
- visual feedback that helps users understand what changed and why;
- interfaces designed specifically around statistical and econometric workflows.

The UI should still remain clean and intuitive. High interactivity must not become visual clutter or unnecessary complexity.

Do not default to ordinary website patterns when a better analytical interaction is possible.

The goal is to build an interface that feels **distinctly designed for exploring and understanding data**, not simply a nicer frontend around statistical functions.

## Making changes

Before changing existing functionality:

1. inspect the relevant code;
2. read the relevant parts of `ARCHITECTURE.md`;
3. understand how the existing logic works;
4. make a focused and deliberate change.

Do not rewrite unrelated working code.

Do not introduce new dependencies, frameworks, or architectural patterns without a clear reason.

Preserve existing behavior unless the requested change requires modifying it.

Update `ARCHITECTURE.md` whenever the change makes its description of the project inaccurate or incomplete.

## Testing

Test important analytical and dataset-related logic.

When fixing a bug, add or update a test when practical.

Do not claim something was tested unless it was actually tested.

## After every change

After completing a change, report:

- what was changed;
- how the new or changed logic works;
- what behavior is different from before;
- what was tested or verified;
- any important performance or memory implications;
- whether `ARCHITECTURE.md` was updated and why.

Also provide concise recommendations when there is a clearly better or more efficient solution worth considering.

Do not hide implementation decisions or silently change behavior.

The project should stay understandable and controllable as it grows.

## General rule

Do not vibe-code Garf.

Understand the existing code and architecture, make deliberate changes, keep implementations simple, keep `ARCHITECTURE.md` synchronized with reality, and explain what was done.

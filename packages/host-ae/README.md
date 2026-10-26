# After Effects host adapter

Project inspection, target re-resolution, action-plan compilation, undo-group
execution, and postcondition reads at the After Effects boundary. Plans are
compiled into typed host commands that the host library (the jsx the native
plugin runs inside After Effects) executes; this package has a Linux
compiler/mock seam so it is testable without After Effects. Host-specific
prompts and Undo behavior are confirmed only by field evidence.

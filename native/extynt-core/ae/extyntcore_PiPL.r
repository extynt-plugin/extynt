/* PiPL (plug-in property list) for the extynt native core, an AEGP.
   On macOS Rez compiles it into Contents/Resources/extyntcore.rsrc (rez_pipl.sh), on Windows cl and
   PiPLTool turn it into a .rc linked into the .aex (windows.cmake), as the SDK samples do. The entry point name must match EntryPointFunc in sdk_entry.cpp. */
#include "AEConfig.h"

#ifndef AE_OS_WIN
	#include "AE_General.r"
#endif

resource 'PiPL' (16000) {
	{
		Kind {
			AEGP
		},
		Name {
			"extyntcore"
		},
		Category {
			"extynt"
		},
		Version {
			65536
		},
#ifdef AE_OS_WIN
    #if defined(AE_PROC_INTELx64)
		CodeWin64X86 {"EntryPointFunc"},
    #elif defined(AE_PROC_ARM64)
		CodeWinARM64 {"EntryPointFunc"},
    #endif
#elif defined(AE_OS_MAC)
		CodeMacIntel64 {"EntryPointFunc"},
		CodeMacARM64 {"EntryPointFunc"},
#endif
	}
};

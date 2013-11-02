solution "Pokuelike"
    configurations { "Debug", "Release" }
    platforms { "native", "x32", "x64" }

    ---------------------------------------
    -- Static Library
    project "test"
        language "C++"

        includedirs { "../pkg/include/tcod" }

        files { "../code/src/**" }

        targetdir "../bin"
        targetname "pokuelike"

        --------------------------------------- 
        -- Link static libraries and config
        libdirs { "../pkg/lib" }
	links { "tcod", "tcodxx" }

        configuration "linux"
            --links { "GL", "X11", "Xrandr", "pthread", "m", "glfw" }

        configuration "windows"
            --links { "glfw", "opengl32" }

        configuration { "native or x64" }
            targetsuffix "64"

        configuration "x32"
            targetsuffix "32"

        --------------------------------------- 
        -- Build rules
        configuration "Debug"
            kind "ConsoleApp" 
            defines "DEBUG"
            flags { "Symbols", "ExtraWarnings" }

        configuration "Release"
            kind "WindowedApp"
            flags { "Optimize", "ExtraWarnings" }


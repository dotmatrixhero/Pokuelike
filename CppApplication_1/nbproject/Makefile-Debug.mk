#
# Generated Makefile - do not edit!
#
# Edit the Makefile in the project folder instead (../Makefile). Each target
# has a -pre and a -post target defined where you can add customized code.
#
# This makefile implements configuration specific macros and targets.


# Environment
MKDIR=mkdir
CP=cp
GREP=grep
NM=nm
CCADMIN=CCadmin
RANLIB=ranlib
CC=gcc
CCC=g++
CXX=g++
FC=gfortran
AS=as

# Macros
CND_PLATFORM=Cygwin_4.x-Windows
CND_CONF=Debug
CND_DISTDIR=dist
CND_BUILDDIR=build

# Include project Makefile
include Makefile

# Object Directory
OBJECTDIR=${CND_BUILDDIR}/${CND_CONF}/${CND_PLATFORM}

# Object Files
OBJECTFILES= \
	${OBJECTDIR}/Actor.o \
	${OBJECTDIR}/Drawable.o \
	${OBJECTDIR}/Terrain.o \
	${OBJECTDIR}/Gameplay.o \
	${OBJECTDIR}/main.o \
	${OBJECTDIR}/TileInterpret.o \
	${OBJECTDIR}/spritetest.o \
	${OBJECTDIR}/Item.o \
	${OBJECTDIR}/MapManager.o \
	${OBJECTDIR}/Effects.o


# C Compiler Flags
CFLAGS=

# CC Compiler Flags
CCFLAGS=
CXXFLAGS=

# Fortran Compiler Flags
FFLAGS=

# Assembler Flags
ASFLAGS=

# Link Libraries and Options
LDLIBSOPTIONS=-L../../libtcod-1.5.0-mingw32/libtcod-1.5.0/lib -L../../libtcod-1.5.0-mingw32/libtcod-1.5.0 -L../../SDL-1.2.15/lib -L../../SDL-1.2.15 -ltcod-gui-mingw -ltcod-mingw -ltcod-gui-mingw-debug -ltcod-mingw-debug -lSDL.dll -lSDLmain

# Build Targets
.build-conf: ${BUILD_SUBPROJECTS}
	"${MAKE}"  -f nbproject/Makefile-${CND_CONF}.mk ${CND_DISTDIR}/${CND_CONF}/${CND_PLATFORM}/cppapplication_1.exe

${CND_DISTDIR}/${CND_CONF}/${CND_PLATFORM}/cppapplication_1.exe: ${OBJECTFILES}
	${MKDIR} -p ${CND_DISTDIR}/${CND_CONF}/${CND_PLATFORM}
	${LINK.cc} -o ${CND_DISTDIR}/${CND_CONF}/${CND_PLATFORM}/cppapplication_1 ${OBJECTFILES} ${LDLIBSOPTIONS} 

${OBJECTDIR}/Actor.o: Actor.cpp 
	${MKDIR} -p ${OBJECTDIR}
	${RM} $@.d
	$(COMPILE.cc) -g -I../../libtcod-1.5.0-mingw32/libtcod-1.5.0/include -I../../SDL-1.2.15/include -I../../SDL-1.2.15 -I../../SDL-1.2.15/lib -I../../libtcod-1.5.0-mingw32 -MMD -MP -MF $@.d -o ${OBJECTDIR}/Actor.o Actor.cpp

${OBJECTDIR}/Drawable.o: Drawable.cpp 
	${MKDIR} -p ${OBJECTDIR}
	${RM} $@.d
	$(COMPILE.cc) -g -I../../libtcod-1.5.0-mingw32/libtcod-1.5.0/include -I../../SDL-1.2.15/include -I../../SDL-1.2.15 -I../../SDL-1.2.15/lib -I../../libtcod-1.5.0-mingw32 -MMD -MP -MF $@.d -o ${OBJECTDIR}/Drawable.o Drawable.cpp

${OBJECTDIR}/Terrain.o: Terrain.cpp 
	${MKDIR} -p ${OBJECTDIR}
	${RM} $@.d
	$(COMPILE.cc) -g -I../../libtcod-1.5.0-mingw32/libtcod-1.5.0/include -I../../SDL-1.2.15/include -I../../SDL-1.2.15 -I../../SDL-1.2.15/lib -I../../libtcod-1.5.0-mingw32 -MMD -MP -MF $@.d -o ${OBJECTDIR}/Terrain.o Terrain.cpp

${OBJECTDIR}/Gameplay.o: Gameplay.cpp 
	${MKDIR} -p ${OBJECTDIR}
	${RM} $@.d
	$(COMPILE.cc) -g -I../../libtcod-1.5.0-mingw32/libtcod-1.5.0/include -I../../SDL-1.2.15/include -I../../SDL-1.2.15 -I../../SDL-1.2.15/lib -I../../libtcod-1.5.0-mingw32 -MMD -MP -MF $@.d -o ${OBJECTDIR}/Gameplay.o Gameplay.cpp

${OBJECTDIR}/main.o: main.cpp 
	${MKDIR} -p ${OBJECTDIR}
	${RM} $@.d
	$(COMPILE.cc) -g -I../../libtcod-1.5.0-mingw32/libtcod-1.5.0/include -I../../SDL-1.2.15/include -I../../SDL-1.2.15 -I../../SDL-1.2.15/lib -I../../libtcod-1.5.0-mingw32 -MMD -MP -MF $@.d -o ${OBJECTDIR}/main.o main.cpp

${OBJECTDIR}/TileInterpret.o: TileInterpret.cpp 
	${MKDIR} -p ${OBJECTDIR}
	${RM} $@.d
	$(COMPILE.cc) -g -I../../libtcod-1.5.0-mingw32/libtcod-1.5.0/include -I../../SDL-1.2.15/include -I../../SDL-1.2.15 -I../../SDL-1.2.15/lib -I../../libtcod-1.5.0-mingw32 -MMD -MP -MF $@.d -o ${OBJECTDIR}/TileInterpret.o TileInterpret.cpp

${OBJECTDIR}/spritetest.o: spritetest.cpp 
	${MKDIR} -p ${OBJECTDIR}
	${RM} $@.d
	$(COMPILE.cc) -g -I../../libtcod-1.5.0-mingw32/libtcod-1.5.0/include -I../../SDL-1.2.15/include -I../../SDL-1.2.15 -I../../SDL-1.2.15/lib -I../../libtcod-1.5.0-mingw32 -MMD -MP -MF $@.d -o ${OBJECTDIR}/spritetest.o spritetest.cpp

${OBJECTDIR}/Item.o: Item.cpp 
	${MKDIR} -p ${OBJECTDIR}
	${RM} $@.d
	$(COMPILE.cc) -g -I../../libtcod-1.5.0-mingw32/libtcod-1.5.0/include -I../../SDL-1.2.15/include -I../../SDL-1.2.15 -I../../SDL-1.2.15/lib -I../../libtcod-1.5.0-mingw32 -MMD -MP -MF $@.d -o ${OBJECTDIR}/Item.o Item.cpp

${OBJECTDIR}/MapManager.o: MapManager.cpp 
	${MKDIR} -p ${OBJECTDIR}
	${RM} $@.d
	$(COMPILE.cc) -g -I../../libtcod-1.5.0-mingw32/libtcod-1.5.0/include -I../../SDL-1.2.15/include -I../../SDL-1.2.15 -I../../SDL-1.2.15/lib -I../../libtcod-1.5.0-mingw32 -MMD -MP -MF $@.d -o ${OBJECTDIR}/MapManager.o MapManager.cpp

${OBJECTDIR}/Effects.o: Effects.cpp 
	${MKDIR} -p ${OBJECTDIR}
	${RM} $@.d
	$(COMPILE.cc) -g -I../../libtcod-1.5.0-mingw32/libtcod-1.5.0/include -I../../SDL-1.2.15/include -I../../SDL-1.2.15 -I../../SDL-1.2.15/lib -I../../libtcod-1.5.0-mingw32 -MMD -MP -MF $@.d -o ${OBJECTDIR}/Effects.o Effects.cpp

# Subprojects
.build-subprojects:

# Clean Targets
.clean-conf: ${CLEAN_SUBPROJECTS}
	${RM} -r ${CND_BUILDDIR}/${CND_CONF}
	${RM} ${CND_DISTDIR}/${CND_CONF}/${CND_PLATFORM}/cppapplication_1.exe

# Subprojects
.clean-subprojects:

# Enable dependency checking
.dep.inc: .depcheck-impl

include .dep.inc

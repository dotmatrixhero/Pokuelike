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
	${OBJECTDIR}/_ext/1445274692/TileInterpret.o \
	${OBJECTDIR}/_ext/1445274692/MapGenerator.o \
	${OBJECTDIR}/_ext/1445274692/Item.o \
	${OBJECTDIR}/_ext/1445274692/main.o \
	${OBJECTDIR}/_ext/1445274692/Gameplay.o \
	${OBJECTDIR}/_ext/1445274692/Drawable.o \
	${OBJECTDIR}/_ext/1445274692/Actor.o \
	${OBJECTDIR}/_ext/1445274692/Pokemon.o \
	${OBJECTDIR}/_ext/1445274692/MapManager.o \
	${OBJECTDIR}/_ext/1445274692/Effect.o \
	${OBJECTDIR}/_ext/1445274692/Terrain.o


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
LDLIBSOPTIONS=-ltcod-gui-mingw-debug -ltcod-gui-mingw -ltcod-mingw-debug -ltcod-mingw

# Build Targets
.build-conf: ${BUILD_SUBPROJECTS}
	"${MAKE}"  -f nbproject/Makefile-${CND_CONF}.mk ${CND_DISTDIR}/${CND_CONF}/${CND_PLATFORM}/pokuelike.exe

${CND_DISTDIR}/${CND_CONF}/${CND_PLATFORM}/pokuelike.exe: ${OBJECTFILES}
	${MKDIR} -p ${CND_DISTDIR}/${CND_CONF}/${CND_PLATFORM}
	${LINK.cc} -o ${CND_DISTDIR}/${CND_CONF}/${CND_PLATFORM}/pokuelike ${OBJECTFILES} ${LDLIBSOPTIONS} 

${OBJECTDIR}/_ext/1445274692/TileInterpret.o: ../../src/TileInterpret.cpp 
	${MKDIR} -p ${OBJECTDIR}/_ext/1445274692
	${RM} $@.d
	$(COMPILE.cc) -g -MMD -MP -MF $@.d -o ${OBJECTDIR}/_ext/1445274692/TileInterpret.o ../../src/TileInterpret.cpp

${OBJECTDIR}/_ext/1445274692/MapGenerator.o: ../../src/MapGenerator.cpp 
	${MKDIR} -p ${OBJECTDIR}/_ext/1445274692
	${RM} $@.d
	$(COMPILE.cc) -g -MMD -MP -MF $@.d -o ${OBJECTDIR}/_ext/1445274692/MapGenerator.o ../../src/MapGenerator.cpp

${OBJECTDIR}/_ext/1445274692/Item.o: ../../src/Item.cpp 
	${MKDIR} -p ${OBJECTDIR}/_ext/1445274692
	${RM} $@.d
	$(COMPILE.cc) -g -MMD -MP -MF $@.d -o ${OBJECTDIR}/_ext/1445274692/Item.o ../../src/Item.cpp

${OBJECTDIR}/_ext/1445274692/main.o: ../../src/main.cpp 
	${MKDIR} -p ${OBJECTDIR}/_ext/1445274692
	${RM} $@.d
	$(COMPILE.cc) -g -MMD -MP -MF $@.d -o ${OBJECTDIR}/_ext/1445274692/main.o ../../src/main.cpp

${OBJECTDIR}/_ext/1445274692/Gameplay.o: ../../src/Gameplay.cpp 
	${MKDIR} -p ${OBJECTDIR}/_ext/1445274692
	${RM} $@.d
	$(COMPILE.cc) -g -MMD -MP -MF $@.d -o ${OBJECTDIR}/_ext/1445274692/Gameplay.o ../../src/Gameplay.cpp

${OBJECTDIR}/_ext/1445274692/Drawable.o: ../../src/Drawable.cpp 
	${MKDIR} -p ${OBJECTDIR}/_ext/1445274692
	${RM} $@.d
	$(COMPILE.cc) -g -MMD -MP -MF $@.d -o ${OBJECTDIR}/_ext/1445274692/Drawable.o ../../src/Drawable.cpp

${OBJECTDIR}/_ext/1445274692/Actor.o: ../../src/Actor.cpp 
	${MKDIR} -p ${OBJECTDIR}/_ext/1445274692
	${RM} $@.d
	$(COMPILE.cc) -g -MMD -MP -MF $@.d -o ${OBJECTDIR}/_ext/1445274692/Actor.o ../../src/Actor.cpp

${OBJECTDIR}/_ext/1445274692/Pokemon.o: ../../src/Pokemon.cpp 
	${MKDIR} -p ${OBJECTDIR}/_ext/1445274692
	${RM} $@.d
	$(COMPILE.cc) -g -MMD -MP -MF $@.d -o ${OBJECTDIR}/_ext/1445274692/Pokemon.o ../../src/Pokemon.cpp

${OBJECTDIR}/_ext/1445274692/MapManager.o: ../../src/MapManager.cpp 
	${MKDIR} -p ${OBJECTDIR}/_ext/1445274692
	${RM} $@.d
	$(COMPILE.cc) -g -MMD -MP -MF $@.d -o ${OBJECTDIR}/_ext/1445274692/MapManager.o ../../src/MapManager.cpp

${OBJECTDIR}/_ext/1445274692/Effect.o: ../../src/Effect.cpp 
	${MKDIR} -p ${OBJECTDIR}/_ext/1445274692
	${RM} $@.d
	$(COMPILE.cc) -g -MMD -MP -MF $@.d -o ${OBJECTDIR}/_ext/1445274692/Effect.o ../../src/Effect.cpp

${OBJECTDIR}/_ext/1445274692/Terrain.o: ../../src/Terrain.cpp 
	${MKDIR} -p ${OBJECTDIR}/_ext/1445274692
	${RM} $@.d
	$(COMPILE.cc) -g -MMD -MP -MF $@.d -o ${OBJECTDIR}/_ext/1445274692/Terrain.o ../../src/Terrain.cpp

# Subprojects
.build-subprojects:

# Clean Targets
.clean-conf: ${CLEAN_SUBPROJECTS}
	${RM} -r ${CND_BUILDDIR}/${CND_CONF}
	${RM} ${CND_DISTDIR}/${CND_CONF}/${CND_PLATFORM}/pokuelike.exe

# Subprojects
.clean-subprojects:

# Enable dependency checking
.dep.inc: .depcheck-impl

include .dep.inc

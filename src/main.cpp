/*
 * File:   main.cpp
 * Author: Brian
 *
 * Created on June 14, 2012, 12:29 AM
 */

#include <cstdlib>
#include <iostream>
#include <fstream>
#include <libtcod/libtcod.hpp>
#include "Actor.h"
#include "Item.h"
#include "Effect.h"
#include "Terrain.h"
#include "Gameplay.h"
#include "MapManager.h"
#include "Renderer.h"
#include <SDL/SDL.h>


int main(int argc, char *argv[]){
    //initialize TCOD console, set font and size
    TCODConsole::setCustomFont("Sir_Henry's_32x32 and sprites.png",TCOD_FONT_LAYOUT_ASCII_INROW,16,161);
    TCODConsole::initRoot(42,24,"WOO!", false,TCOD_RENDERER_SDL);
    int row = 256;
    //map custom symbols to font
    for (int x = 0;x<145;x++){
        TCODConsole::mapAsciiCodesToFont(row+x,16,(x%16),16+(x/16));
    }
    //set fps, resolution, fullscreen
    TCODSystem::setFps(40);
    TCODSystem::forceFullscreenResolution(1280,768);
    TCODConsole::setFullscreen(true);
    Renderer* HUDRender = new Renderer();
    TCODSystem::registerSDLRenderer(HUDRender);
    //main menu
    //if loaded game, initalize a new actor taking old stats
    //initialize new gameplay with old stats
    //load old map manager
    //load map

    Pokemon hero = Pokemon(10,10,304,TCODColor::white, TCODColor::blue, false, false, "HERO"); //figure out how to randomize position of hero
//49+4

    Gameplay play = Gameplay(&hero, HUDRender);
   // while (!TCODConsole::isWindowClosed()=){

   int endgame = 1;
   while ( endgame != 0){
        endgame = play.playgame();
    }



}




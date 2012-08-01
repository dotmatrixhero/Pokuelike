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

int main(){
    std::cout<<"hello";
    TCODConsole::setCustomFont("Sir_Henry's_32x32.png",TCOD_FONT_LAYOUT_ASCII_INROW);
    TCODConsole::initRoot(42,24,"WOO!");
    TCODSystem::setFps(40);
    TCODSystem::forceFullscreenResolution(1280,768);
    TCODConsole::setFullscreen(false);
    //main menu
    //if loaded game, initalize a new actor taking old stats
    //initialize new gameplay with old stats
    //load old map manager
    //load map

    Actor hero = Actor(10,10,64,TCODColor::white, TCODColor::black, false, false); //figure out how to randomize position of hero


    Gameplay play = Gameplay(&hero);
   // while (!TCODConsole::isWindowClosed()=){

   int endgame = 1;
   while ( endgame != 0){
        endgame = play.playgame();
    }
    play.~Gameplay();


}




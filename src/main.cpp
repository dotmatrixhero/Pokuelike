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

int main() {

    TCODConsole::initRoot(100,75,"WOO!",false);
    TCODSystem::setFps(40);
  
    //main menu
    //if loaded game, initalize a new actor taking old stats
    //initialize new gameplay with old stats
    //load old map manager
    //load map
    TCODConsole* ConsoleMap = new TCODConsole(50,25); //mapw, maph
    Actor hero = Actor(30,20,64,TCODColor::white, TCODColor::black, false, false); 
    /*these two lines will have to be switched if i want to implemet*/
    MapManager map = MapManager(ConsoleMap);
    
    Gameplay play = Gameplay(&hero, &map); /*non-set map values, so i have to rework "hero"*/
    play.compTurn();
    while (!TCODConsole::isWindowClosed()){
        play.console();  //starting a new game
        if(play.playerTurn() == 0){
            //save game
            return 0;
        }
        if(play.playerTurn() == 2){
            //inventory
        }
        play.clear();
        //if play-> playerturn returns something else (when no keys are pressed, just continue to terrmap draw)
        play.compTurn();
    }

    return 0;
}




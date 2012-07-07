/* 
 * File:   main.cpp
 * Author: Brian
 *
 * Created on June 14, 2012, 12:29 AM
 */

#include <cstdlib>
#include <iostream>
#include <fstream>
#include "libtcod.hpp"
#include "SDL/SDL.h"
#include "Actor.h"
#include "Item.h"
#include "Effects.h"
#include "Terrain.h"
#include "Gameplay.h"
#include "MapManager.h"

using namespace std;

/*
 * 
 */
void tryMove(Actor*);

int main() {
   
    TCODConsole::initRoot(100,75,"WOO!",false);
    //main menu
    //if loaded game, initalize a new actor taking old stats
    //initialize new gameplay with old stats
    //load old map manager
    //load map
    
    //if new:
     Actor* hero = new Actor(50,50,64); /*these two lines will have to be switched if i want to implemet*/
     Gameplay* play = new Gameplay(hero); /*non-set map values, so i have to rework "hero"*/
     MapManager* map = new MapManager();
     TCODSystem::setFps(40);
     map->createTerrArray();
     map->terrToDraw();
    while (!TCODConsole::isWindowClosed()){
        play->console();  //starting a new game
        if(play->playerTurn() == 0){
            //save game
            return 0;
        }
        if(play->playerTurn() == 2){
            //inventory
        }
        play->clear();
        //if play-> playerturn returns something else (when no keys are pressed, just continue to terrmap draw)
        map->terrToDraw();
    }
    //loading a game
        delete hero;
        delete play;
        return 0;
}




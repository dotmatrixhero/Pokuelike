/*
 * File:   MapManager.cpp
 * Author: Brian
 *
 * Created on June 17, 2012, 7:33 PM
 */

#include "MapManager.h"
#include <iostream>
#include <fstream>
#include <libtcod/libtcod.hpp>


using namespace std;

MapManager::MapManager(TCODConsole* consolemap) {
    ConsoleMap = consolemap;
    for(int A = 0; A<mapw; A++){
        for(int B =0; B<maph; B++){
          arrayExplored[A][B]=false;
        }}
}


bool MapManager::isWalkable(int x, int y){

    return gameMap->isWalkable(x,y); //this actually returns my boolean.
}

void MapManager::makeNew(){
    gameMap = new TCODMap(mapw,maph);
    gameMap->setProperties(78,45,true,true);
    //random gen and then write to file?
}

void MapManager::loadMap(/* get a file*/){
    //load the map from file, use iterator
}


void MapManager::createItemArray(){
    ifstream myReadFile;
    myReadFile.open("itemmaptest.txt");
    string input;
    int x=0;
    int y=0;
    while(myReadFile.good()){
        getline(myReadFile, input);
        if (input.empty()){
            cout<<"input #1 empty";
        break; }
        getline(myReadFile, input);
        cout<<input;
        cout<<"\n";

        //if (y==17){//THIS IS BAD PROGRAMMING, GOTTA FIX
        //    break;
       // }
        if (tilein.getItem(input) == NULL){
            cout<< "output empty";
            break;
        }

        Item* copyThis = tilein.getItem(input);//copy
        cout<<copyThis->returnc();
        cout<<"\n";
        arrayItem[x][y] = new Item(x,y,copyThis->returnc(),copyThis->returnfore(),copyThis->returnback(), copyThis->returntrans(),copyThis->returnwalk(), copyThis->returnkey());
          if (x<mapw){
              if (y<maph){
                  y++;
              }
              if (y==maph){
                  y=0;
                  x++;
              }
       }
    }
}


void MapManager::createTerrArray(){
    ifstream myReadFile;
    myReadFile.open("maptest2.txt");
    string input;
    while(myReadFile.good()){
        for (int x =0; x<mapw; x++){
        for (int y =0 ; y < maph; y++){
                getline(myReadFile, input);
                if (input.empty()){
                        cout<<"input #1 empty";
                        cout<<"\n";
                return; }
                getline(myReadFile, input);


                 if (tilein.getTerrain(input) == NULL){ //ON THIS check, something happens...
                        cout<< "output empty";
                 return;
                }

                Terrain* copyThis = tilein.getTerrain(input);//copy

             arrayTerrain[x][y] = new Terrain(x,y,copyThis->returnc(),copyThis->returnfore(),copyThis->returnback(), copyThis->returntrans(),copyThis->returnwalk(), copyThis->returnkey());
        }}
    }


}


void MapManager::createActoArray(){
    ifstream myReadFile;
    myReadFile.open("actomaptest.txt");
    string input;
    int x=0;
    int y=0;
    while(myReadFile.good()){
        getline(myReadFile, input);
        if (input.empty()){
            cout<<"input #1 empty";
        break; }
        getline(myReadFile, input);
        cout<<input;
        cout<<"\n";

        if (tilein.getActor(input) == NULL){ //ON THIS check, something happens...
            cout<< "output empty";
            break;
        }

        Actor* copyThis = tilein.getActor(input);//copy
        cout<<copyThis->returnc();
        cout<<"\n";
        arrayActors[x][y] = new Actor(x,y,copyThis->returnc(),copyThis->returnfore(),copyThis->returnback(), copyThis->returntrans(),copyThis->returnwalk(), copyThis->returnkey());
        if (x<mapw){
              if (y<maph){
                  y++;
              }
              if (y==maph){
                  y=0;
                  x++;
              }
       }
    }


}


void MapManager::createEffeArray(){
    ifstream myReadFile;
    myReadFile.open("effemaptest.txt");
    string input;
    int x=0;
    int y=0;
    while(myReadFile.good()){
        getline(myReadFile, input);
        if (input.empty()){
            cout<<"input #1 empty";
        break; }
        getline(myReadFile, input);
        cout<<input;
        cout<<"\n";

        if (tilein.getEffect(input) == NULL){ //ON THIS check, something happens...
            cout<< "output empty";
            break;
        }

        Effect* copyThis = tilein.getEffect(input);//copy
        cout<<"\n";
        arrayEffects[x][y] = new Effect(x,y,copyThis->returnc(),copyThis->returnfore(),copyThis->returnback(), copyThis->returntrans(),copyThis->returnwalk(),copyThis->returnkey());
          if (x<mapw){
              if (y<maph){
                  y++;
              }
              if (y==maph){
                  y=0;
                  x++;
              }
       }
    }


}


void MapManager::terrToDraw(bool wholeMap, vector<int> FOV){
    vector<int>::iterator it;
    it=FOV.begin();
            for (int x =0; x<mapw; x++){
                  for(int y =0 ; y < maph; y++){
                      if (arrayTerrain[x][y] != NULL){
                        Terrain* a = arrayTerrain[x][y];
                        gameMap->setProperties(x,y,a->returntrans(),a->returnwalk());
                        if(wholeMap){
                                a->draw(ConsoleMap);
                        }else{
                                if (arrayExplored[x][y])
                                    a->drawWashed(ConsoleMap);//store memory.... blit a separate console? should not update..
                                if (it != FOV.end()){
                                        int p = *it;
                                        it++;
                                        int q = *it;
                                        it++;
                                        if(x==p && y==q){
                                                a->draw(ConsoleMap);//perhaps this should be drawn on a transparent console?
                                        }else{
                                                it = it-2;
                                }
                        }
                      }
                  }
            }


    }
}


void MapManager::itemToDraw(){
    for (int x =0; x<mapw; x++){
          for(int y =0 ; y < maph; y++){
              if (arrayItem[x][y] != NULL){
                  Item* a = arrayItem[x][y];
                  a->draw(ConsoleMap);
                  gameMap->setProperties(x,y,a->returntrans(),a->returnwalk());


              }}}
}


void MapManager::actoToDraw(){
    for (int x =0; x<mapw; x++){
          for(int y =0 ; y < maph; y++){
              if (arrayActors [x][y] != NULL){
                  Actor* a = arrayActors[x][y];
                  a->draw(ConsoleMap);
                  gameMap->setProperties(x,y,a->returntrans(),a->returnwalk());
    //   if terrain is not walkable, throw coordinates into an array called.....arrayNotWalk
    //   if terrain is not viewable throw coordinates into an array called....arrayNotTrans



              }}}
}



void MapManager::effeToDraw(){
    for (int x =0; x<mapw; x++){
          for(int y =0 ; y < maph; y++){
              if (arrayEffects[x][y] != NULL){
                  Effect* a = arrayEffects[x][y];
                  a->draw(ConsoleMap);
                  gameMap->setProperties(x,y,a->returntrans(),a->returnwalk());
    //   if terrain is not walkable, throw coordinates into an array called.....arrayNotWalk
    //   if terrain is not viewable throw coordinates into an array called....arrayNotTrans


              }}}
}

vector<int> MapManager::FOV(int playerx, int playery){
    gameMap->computeFov(playerx, playery, 5, true, FOV_SHADOW); //max radius depends on player clairvoyance
  //  gameMap->computeFov(20,20,2,true,FOV_PERMISSIVE_3);
    vector<int> FOV;
    for(int A = 0; A<mapw; A++){
        for(int B =0; B<maph; B++){
                if (gameMap->isInFov(A,B)){
                   FOV.push_back(A);
                   FOV.push_back(B);
                   arrayExplored[A][B] = (true);
                //   if((returnTerrain(A,B)->returnkey()).compare("airr")==0)


                }
        }
   }

    return FOV;
}

TCODConsole* MapManager::returnConsoleMap(){

    return ConsoleMap;
}

TCODMap* MapManager::returnFOVMap(){
    return gameMap;
}

Terrain* MapManager::returnTerrain(int posx, int posy){
    // cout << arrayTerrain[posx][posy]->returnkey();
    return arrayTerrain[posx][posy];
}

void MapManager::setFloorAbove(MapManager* floorabove){
    floorAbove = floorabove;
}

void MapManager::setFloorBelow(MapManager* floorbelow){
    floorBelow = floorbelow;
}

MapManager::~MapManager() {
    delete gameMap;
}


/* 
 * File:   TileInterpret.cpp
 * Author: Exiiile
 * 
 * Created on June 20, 2012, 2:27 PM
 */

#include "TileInterpret.h"

#include <libtcod/libtcod.hpp>

#include <iostream>
#include <fstream>
#include <string>

using namespace std;

TileInterpret::TileInterpret() {
    ifstream myReadFile;
    string input;
    myReadFile.open("tileinterpret.txt");

    while (myReadFile.good()){
        string foo;
        std::getline(myReadFile, foo, '\n');
        std::getline(myReadFile, foo, '\n');
        string type = foo;
        std::getline(myReadFile, foo, '\n');
        string key = foo;

        std::getline(myReadFile, foo, '\n');
        int i = atoi(std::string(foo).c_str());
        std::getline(myReadFile, foo, '\n' );//colors
        std::getline(myReadFile,foo, '\n');
        std::getline(myReadFile, foo, '\n');
        bool trans = (foo == "1");
        std::getline(myReadFile, foo, '\n');    
        bool walk = (foo == "1");
        if (!walk){
            cout<<"not walk";
             cout<<"\n";
        }
        std::getline(myReadFile, foo, '\n');
        TCODColor myColor(24,64,255);//temp
        TCODColor myColor2(24,64,0);//temp
        if (type.compare(0,4,"terr")== 0){    
            Terrain* a = new Terrain(i, myColor, myColor2, trans, walk);
            // terrVect.push_back(a);
            terrainMap[key] = a;//possible that this is not iterating
            //terrVect will eventually become tileVect, and tileinterpret will contain information 
            //for all tiles. There will have to be a series of checks at the beginning to determine
            //what type of Drawable the object is, so as to parse the correct data blocks (is destructible,
            //hp, regen, pp, moves, shiny, glowing, does damage, does type damage, is friendable, personality etc.
        }
        if (type.compare(0,4,"item")== 0){
            Item* a = new Item(i, myColor, myColor2, trans, walk);
            itemMap[key] = a;//possible that this is not iterating
        }

        if (type.compare(0,4,"acto")== 0){
            Actor* a = new Actor(i, myColor, myColor2, trans, walk);
            actorMap[key] = a;//possible that this is not iterating
        }
        if (type.compare(0,4,"effe")== 0){
            Effect* a = new Effect(i, myColor, myColor2, trans, walk);
            effectMap[key] = a;//possible that this is not iterating
        }


    }
    myReadFile.close();
}

TileInterpret::~TileInterpret()
{
    for (std::map<std::string, Terrain*>::iterator iter = terrainMap.begin(); 
         iter != terrainMap.end(); 
         ++iter)
    {
        delete iter->second;
    }

    for (std::map<std::string, Item*>::iterator iter = itemMap.begin(); 
         iter != itemMap.end(); 
         ++iter)
    {
        delete iter->second;
    }

    for (std::map<std::string, Actor*>::iterator iter = actorMap.begin(); 
         iter != actorMap.end(); 
         ++iter)
    {
        delete iter->second;
    }

    for (std::map<std::string, Effect*>::iterator iter = effectMap.begin(); 
         iter != effectMap.end(); 
         ++iter)
    {
        delete iter->second;
    }
}

Terrain* TileInterpret::getTerrain(const std::string& key)
{
    return (terrainMap.find(key) != terrainMap.end()) ? terrainMap[key] : NULL;
}

Item*    TileInterpret::getItem(const std::string& key)
{
    return (itemMap.find(key) != itemMap.end()) ? itemMap[key] : NULL;
}

Actor*   TileInterpret::getActor(const std::string& key)
{
    return (actorMap.find(key) != actorMap.end()) ? actorMap[key] : NULL;
}

Effect*  TileInterpret::getEffect(const std::string& key)
{
    return (effectMap.find(key) != effectMap.end()) ? effectMap[key] : NULL;
}


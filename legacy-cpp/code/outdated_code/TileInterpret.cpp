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
        TCODColor myColor = returnColor(foo);
        std::getline(myReadFile,foo, '\n');
        TCODColor myColor2 = returnColor(foo);
        std::getline(myReadFile, foo, '\n');
        bool trans = (foo.compare(0,1,"1") == 0);
        std::getline(myReadFile, foo, '\n');
        bool walk = (foo.compare(0,1,"1") == 0);
        std::getline(myReadFile, foo, '\n');
        //TCODColor myColor(24,64,255);//temp
        //TCODColor myColor2(24,0,0);//temp
        if (type.compare(0,4,"terr")== 0){
            Terrain* a = new Terrain(i, myColor, myColor2, trans, walk);
            a->setKey(key);
            cout<< key<<"\n";
            // terrVect.push_back(a);
            terrainMap[key] = a;//possible that this is not iterating
            //terrVect will eventually become tileVect, and tileinterpret will contain information
            //for all tiles. There will have to be a series of checks at the beginning to determine
            //what type of Drawable the object is, so as to parse the correct data blocks (is destructible,
            //hp, regen, pp, moves, shiny, glowing, does damage, does type damage, is friendable, personality etc.
        }
        if (type.compare(0,4,"item")== 0){
            Item* a = new Item(i, myColor, myColor2, trans, walk);
            a->setKey(key);

            itemMap[key] = a;//possible that this is not iterating
        }

        if (type.compare(0,4,"acto")== 0){
            Actor* a = new Actor(i, myColor, myColor2, trans, walk);
            a->setKey(key);
            actorMap[key] = a;//possible that this is not iterating
        }
        if (type.compare(0,4,"effe")== 0){
            Effect* a = new Effect(i, myColor, myColor2, trans, walk);
            a->setKey(key);
            effectMap[key] = a;//possible that this is not iterating
        }
    }
    myReadFile.close();

}

TCODColor TileInterpret::returnColor(string color){ //add custom color option
    if (color.compare(0,5,"desrd")== 0)
        return TCODColor::desaturatedRed;
    if (color.compare(0,5,"litrd")== 0)
        return TCODColor::lightRed;
    if (color.compare(0,5,"stdrd")== 0)
        return TCODColor::red;
    if (color.compare(0,5,"drkrd")== 0)
        return TCODColor::darkRed;
    if (color.compare(0,5,"dktrd")== 0)
        return TCODColor::darkerRed;
    if (color.compare(0,5,"desor")== 0)
        return TCODColor::desaturatedOrange;
    if (color.compare(0,5,"litor")== 0)
        return TCODColor::lightOrange;
    if (color.compare(0,5,"stdor")== 0)
        return TCODColor::orange;
    if (color.compare(0,5,"drkor")== 0)
        return TCODColor::darkOrange;
    if (color.compare(0,5,"dktor")== 0)
        return TCODColor::darkerOrange;
    if (color.compare(0,5,"desyl")== 0)
        return TCODColor::desaturatedYellow;
    if (color.compare(0,5,"lityl")== 0)
        return TCODColor::lightYellow;
    if (color.compare(0,5,"stdyl")== 0)
        return TCODColor::yellow;
    if (color.compare(0,5,"drkyl")== 0)
        return TCODColor::darkYellow;
    if (color.compare(0,5,"dktyl")== 0)
        return TCODColor::darkerYellow;
    if (color.compare(0,5,"desct")== 0)
        return TCODColor::desaturatedChartreuse;
    if (color.compare(0,5,"litct")== 0)
        return TCODColor::lightChartreuse;
    if (color.compare(0,5,"stdct")== 0)
        return TCODColor::chartreuse;
    if (color.compare(0,5,"drkct")== 0)
        return TCODColor::darkChartreuse;
    if (color.compare(0,5,"dktct")== 0)
        return TCODColor::darkerChartreuse;
    if (color.compare(0,5,"desgn")== 0)
        return TCODColor::desaturatedGreen;
    if (color.compare(0,5,"litgn")== 0)
        return TCODColor::lightGreen;
    if (color.compare(0,5,"stdgn")== 0)
        return TCODColor::green;
    if (color.compare(0,5,"drkgn")== 0)
        return TCODColor::darkGreen;
    if (color.compare(0,5,"dktgn")== 0)
        return TCODColor::darkerGreen;
    if (color.compare(0,5,"dessa")== 0)
        return TCODColor::desaturatedSea;
    if (color.compare(0,5,"litsa")== 0)
        return TCODColor::lightSea;
    if (color.compare(0,5,"stdsa")== 0)
        return TCODColor::sea;
    if (color.compare(0,5,"drksa")== 0)
        return TCODColor::darkSea;
    if (color.compare(0,5,"dktsa")== 0)
        return TCODColor::darkerSea;
    if (color.compare(0,5,"descn")== 0)
        return TCODColor::desaturatedCyan;
    if (color.compare(0,5,"litcn")== 0)
        return TCODColor::lightCyan;
    if (color.compare(0,5,"stdcn")== 0)
        return TCODColor::cyan;
    if (color.compare(0,5,"drkcn")== 0)
        return TCODColor::darkCyan;
    if (color.compare(0,5,"dktcn")== 0)
        return TCODColor::darkerCyan;
    if (color.compare(0,5,"dessy")== 0)
        return TCODColor::desaturatedSky;
    if (color.compare(0,5,"litsy")== 0)
        return TCODColor::lightSky;
    if (color.compare(0,5,"stdsy")== 0)
        return TCODColor::sky;
    if (color.compare(0,5,"drksy")== 0)
        return TCODColor::darkSky;
    if (color.compare(0,5,"dktsy")== 0)
        return TCODColor::darkerSky;
    if (color.compare(0,5,"desbl")== 0)
        return TCODColor::desaturatedBlue;
    if (color.compare(0,5,"litbl")== 0)
        return TCODColor::lightBlue;
    if (color.compare(0,5,"stdbl")== 0)
        return TCODColor::blue;
    if (color.compare(0,5,"drkbl")== 0)
        return TCODColor::darkBlue;
    if (color.compare(0,5,"dktbl")== 0)
        return TCODColor::darkerBlue;
    if (color.compare(0,5,"desvt")== 0)
        return TCODColor::desaturatedViolet;
    if (color.compare(0,5,"litvt")== 0)
        return TCODColor::lightViolet;
    if (color.compare(0,5,"stdvt")== 0)
        return TCODColor::violet;
    if (color.compare(0,5,"drkvt")== 0)
        return TCODColor::darkViolet;
    if (color.compare(0,5,"dktvt")== 0)
        return TCODColor::darkerViolet;
    if (color.compare(0,5,"desmg")== 0)
        return TCODColor::desaturatedMagenta;
    if (color.compare(0,5,"litmg")== 0)
        return TCODColor::lightMagenta;
    if (color.compare(0,5,"stdmg")== 0)
        return TCODColor::magenta;
    if (color.compare(0,5,"drkmg")== 0)
        return TCODColor::darkMagenta;
    if (color.compare(0,5,"dktmg")== 0)
        return TCODColor::darkerMagenta;
    if (color.compare(0,5,"despk")== 0)
        return TCODColor::desaturatedPink;
    if (color.compare(0,5,"litpk")== 0)
        return TCODColor::lightPink;
    if (color.compare(0,5,"stdpk")== 0)
        return TCODColor::pink;
    if (color.compare(0,5,"drkpk")== 0)
        return TCODColor::darkPink;
    if (color.compare(0,5,"dktpk")== 0)
        return TCODColor::darkerPink;
    if (color.compare(0,5,"black")== 0)
        return TCODColor::black;
    if (color.compare(0,5,"dktgy")== 0)
        return TCODColor::darkerGrey;
    if (color.compare(0,5,"drkgy")== 0)
        return TCODColor::darkGrey;
    if (color.compare(0,5,"grey")== 0)
        return TCODColor::grey;
    if (color.compare(0,5,"litgy")== 0)
        return TCODColor::lightGrey;
    if (color.compare(0,5,"white")==0)
        return TCODColor::white;
    if (color.compare(0,5,"custm")==0){
        string r = color.substr(6,3);
        string g = color.substr(10,3);
        string b = color.substr(14,3);
        int R = atoi(std::string(r).c_str());
        int G = atoi(std::string(g).c_str());
        int B = atoi(std::string(b).c_str());
        return TCODColor(R,G,B);
    }
    return TCODColor::black;
}

TileInterpret::~TileInterpret()
{

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

